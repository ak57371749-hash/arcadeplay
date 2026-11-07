// ArcadePlay Tic Tac Toe in-game voice chat
// Load this file AFTER the existing multiplayer.html game script.
(() => {
  const $ = id => document.getElementById(id);
  const style = document.createElement("style");
  style.textContent = `
    #apVoicePanel{margin:16px 0;padding:15px;background:#0b0e18;border:1px solid #343346;border-radius:14px;text-align:center}
    #apVoicePanel .ap-controls{display:flex;gap:8px;margin-top:10px}
    #apVoicePanel button{flex:1;border:0;border-radius:12px;padding:13px;font-weight:800;background:#2b283b;color:white}
    #apVoicePanel #apVoiceStart{background:#ff304b}
    #apVoicePanel button:disabled{opacity:.45}
    #apVoiceStatus{font-size:13px;color:#aaa7b5;margin-top:8px;line-height:1.4}
    @media(max-width:430px){#apVoicePanel .ap-controls{flex-direction:column}}
  `;
  document.head.appendChild(style);

  const panel = document.createElement("section");
  panel.id = "apVoicePanel";
  panel.innerHTML = `
    <strong>🎙️ Voice Chat</strong>
    <div id="apVoiceStatus">Game ke dauran baat karne ke liye Start Voice dabao.</div>
    <div class="ap-controls">
      <button id="apVoiceStart">START VOICE</button>
      <button id="apVoiceMute" disabled>MUTE MIC</button>
      <button id="apVoiceLeave" disabled>LEAVE VOICE</button>
    </div>
    <div id="apRemoteAudioWrap"></div>
    <p style="font-size:12px;color:#aaa7b5;line-height:1.4">Mic permission sirf Start Voice dabane par maangi jayegi. Audio record nahi hoti.</p>
  `;

  function mountPanel() {
    const room = $("room");
    const board = document.querySelector(".board");
    if (room && board && ! $("apVoicePanel")) board.insertAdjacentElement("afterend", panel);
  }
  mountPanel();
  const observer = new MutationObserver(mountPanel);
  observer.observe(document.body, {childList:true,subtree:true});

  const audio = document.createElement("audio");
  audio.id = "apRemoteAudio";
  audio.autoplay = true;
  audio.playsInline = true;
  audio.style.display = "none";
  document.body.appendChild(audio);

  const rtcConfig = {iceServers:[{urls:"stun:stun.l.google.com:19302"}]};
  let voiceRef = null, peer = null, localStream = null;
  let roomListener = null, candidateListener = null;
  let started = false, muted = false, queuedCandidates = [];

  function status(message) { $("apVoiceStatus").textContent = message; }

  function stopVoice() {
    if (voiceRef && roomListener) voiceRef.off("value", roomListener);
    if (voiceRef && candidateListener) {
      voiceRef.child(mark === "X" ? "guestCandidates" : "hostCandidates").off("child_added", candidateListener);
    }
    if (peer) { peer.close(); peer = null; }
    if (localStream) { localStream.getTracks().forEach(track => track.stop()); localStream = null; }
    audio.srcObject = null;
    voiceRef = null; roomListener = null; candidateListener = null;
    started = false; muted = false; queuedCandidates = [];
    $("apVoiceStart").disabled = false;
    $("apVoiceMute").disabled = true;
    $("apVoiceMute").textContent = "MUTE MIC";
    $("apVoiceLeave").disabled = true;
  }

  async function flushCandidates() {
    if (!peer || !peer.remoteDescription) return;
    for (const candidate of queuedCandidates.splice(0)) {
      try { await peer.addIceCandidate(candidate); } catch (_) {}
    }
  }

  async function startVoice() {
    if (started) return;
    if (!uid || !roomId || !room || !mark || !room.guestUid) {
      status("Pehle dono players game room mein join karein.");
      return;
    }
    started = true;
    $("apVoiceStart").disabled = true;
    status("Microphone permission ka wait ho raha hai…");
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Microphone ke liye HTTPS aur supported browser zaroori hai.");
      }
      localStream = await navigator.mediaDevices.getUserMedia({
        audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},
        video:false
      });

      voiceRef = db.ref("voiceRooms/" + roomId);
      await voiceRef.child(mark === "X" ? "hostUid" : "guestUid").set(uid);

      peer = new RTCPeerConnection(rtcConfig);
      localStream.getTracks().forEach(track => peer.addTrack(track, localStream));

      peer.ontrack = event => {
        audio.srcObject = event.streams[0];
        audio.play().catch(() => status("Doosre player ki awaaz sunne ke liye screen par ek baar tap karein."));
        status("🎉 Voice connected!");
      };
      peer.onconnectionstatechange = () => {
        if (!peer) return;
        if (peer.connectionState === "connected") status("🎉 Voice connected!");
        if (peer.connectionState === "failed") status("Network connection fail. Kuch networks par TURN relay ki zaroorat ho sakti hai.");
        if (peer.connectionState === "disconnected") status("Connection interrupt hua hai…");
      };
      peer.onicecandidate = event => {
        if (event.candidate && voiceRef) {
          voiceRef.child(mark === "X" ? "hostCandidates" : "guestCandidates")
            .push(event.candidate.toJSON()).catch(() => {});
        }
      };

      candidateListener = snapshot => {
        const data = snapshot.val();
        if (!data || !peer) return;
        const candidate = new RTCIceCandidate(data);
        if (peer.remoteDescription) peer.addIceCandidate(candidate).catch(() => {});
        else queuedCandidates.push(candidate);
      };
      voiceRef.child(mark === "X" ? "guestCandidates" : "hostCandidates")
        .on("child_added", candidateListener);

      roomListener = async snapshot => {
        const data = snapshot.val();
        if (!data || !peer) return;
        try {
          if (mark === "X" && data.guestUid && !data.offer && !peer.localDescription) {
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            await voiceRef.child("offer").set({type:offer.type,sdp:offer.sdp});
          }
          if (mark === "O" && data.offer && !peer.remoteDescription) {
            await peer.setRemoteDescription(new RTCSessionDescription(data.offer));
            await flushCandidates();
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            await voiceRef.child("answer").set({type:answer.type,sdp:answer.sdp});
          }
          if (mark === "X" && data.answer && !peer.remoteDescription) {
            await peer.setRemoteDescription(new RTCSessionDescription(data.answer));
            await flushCandidates();
          }
        } catch (error) {
          status("Voice connect nahi ho paya: " + error.message);
        }
      };
      voiceRef.on("value", roomListener, error => status("Voice room error: " + error.message));

      $("apVoiceMute").disabled = false;
      $("apVoiceLeave").disabled = false;
      status("Mic on. Doosre player ke Start Voice dabane ka wait hai…");
    } catch (error) {
      status(error.name === "NotAllowedError"
        ? "Microphone permission allow karo, phir dobara try karo."
        : error.message);
      stopVoice();
    }
  }

  $("apVoiceStart").addEventListener("click", startVoice);
  $("apVoiceMute").addEventListener("click", () => {
    if (!localStream) return;
    muted = !muted;
    localStream.getAudioTracks().forEach(track => track.enabled = !muted);
    $("apVoiceMute").textContent = muted ? "UNMUTE MIC" : "MUTE MIC";
    status(muted ? "Mic muted." : "Mic on.");
  });
  $("apVoiceLeave").addEventListener("click", () => {
    stopVoice();
    status("Voice chat band kar di gayi.");
  });
  $("leave").addEventListener("click", stopVoice);
  window.addEventListener("beforeunload", stopVoice);
})();
