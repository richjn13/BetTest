"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CAMERA_INBOX_ADDRESS,
  fetchSignals,
  HEARTBEAT_INTERVAL_MS,
  holdScreenAwake,
  postSignal,
  type Command,
  type IceServer,
} from "@/lib/dogcam-client";

/**
 * The device left at home. It holds the camera open, answers anyone who asks to
 * watch, and takes a handful of orders down the connection once it is up --
 * pause, resume, flip -- so turning the camera off from work costs no server
 * traffic at all.
 *
 * Everything mutable lives in a ref. The polling loop and the connection
 * callbacks outlive any one render, and reading React state from them would
 * mean reading whatever it was when the callback was made.
 */

/**
 * The two slots this connection sends down, remembered by name. Once a track
 * has been pulled out of a sender there is nothing left on it to say whether it
 * was the picture or the sound, so resuming would have to guess.
 */
type Peer = {
  pc: RTCPeerConnection;
  video: RTCRtpSender | null;
  audio: RTCRtpSender | null;
};

const POLL_IDLE_MS = 4_000;
const POLL_BUSY_MS = 1_200;

export function CameraStage({
  slug,
  initialName,
  iceServers,
}: {
  slug: string;
  initialName: string;
  iceServers: IceServer[];
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, Peer>>(new Map());
  const cursorRef = useRef(0);
  const runningRef = useRef(false);
  const facingRef = useRef<"user" | "environment">("environment");
  const wakeRef = useRef<{ release: () => void } | null>(null);

  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [watchers, setWatchers] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [name] = useState(initialName);

  /** Opens the camera, or reopens it on the other lens after a flip. */
  const openCamera = useCallback(async (): Promise<MediaStream> => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facingRef.current, width: { ideal: 1280 } },
      audio: true,
    });
    streamRef.current = stream;
    if (videoRef.current) videoRef.current.srcObject = stream;
    return stream;
  }, []);

  /** Hands whatever the camera is producing now to every connected watcher. */
  const publish = useCallback((stream: MediaStream | null) => {
    for (const { pc } of peersRef.current.values()) {
      for (const sender of pc.getSenders()) {
        const kind = sender.track?.kind ?? "video";
        const next = stream
          ? ((kind === "audio"
              ? stream.getAudioTracks()
              : stream.getVideoTracks())[0] ?? null)
          : null;
        void sender.replaceTrack(next).catch(() => {});
      }
    }
  }, []);

  const releaseCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const runCommand = useCallback(
    async (command: Command) => {
      try {
        if (command.action === "pause") {
          publish(null);
          releaseCamera();
          setPaused(true);
          return;
        }
        if (command.action === "resume") {
          publish(await openCamera());
          setPaused(false);
          return;
        }
        if (command.action === "flip") {
          facingRef.current =
            facingRef.current === "user" ? "environment" : "user";
          releaseCamera();
          publish(await openCamera());
          setPaused(false);
          return;
        }
        if (command.action === "torch") {
          const track = streamRef.current?.getVideoTracks()[0];
          // Not in the DOM types, and not on most cameras. Worth a try; a
          // phone that has a light is the one device you might leave in a
          // dark room.
          await track?.applyConstraints({
            advanced: [{ torch: command.on }],
          } as unknown as MediaTrackConstraints);
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    },
    [openCamera, publish, releaseCamera],
  );

  const dropPeer = useCallback((id: string) => {
    const peer = peersRef.current.get(id);
    if (!peer) return;
    peer.pc.close();
    peersRef.current.delete(id);
    setWatchers(peersRef.current.size);
  }, []);

  /** Someone asked to watch. Answer them and start sending. */
  const answer = useCallback(
    async (viewerId: string, offer: RTCSessionDescriptionInit) => {
      dropPeer(viewerId);

      const pc = new RTCPeerConnection({ iceServers });
      const stream = streamRef.current;
      const video = stream?.getVideoTracks()[0];
      const audio = stream?.getAudioTracks()[0];

      // A paused camera still opens both slots, empty. Filling one later is a
      // track swap; adding one later would mean renegotiating from scratch.
      const peer: Peer = {
        pc,
        video: video
          ? pc.addTrack(video, stream!)
          : pc.addTransceiver("video", { direction: "sendonly" }).sender,
        audio: audio
          ? pc.addTrack(audio, stream!)
          : pc.addTransceiver("audio", { direction: "sendonly" }).sender,
      };
      peersRef.current.set(viewerId, peer);
      setWatchers(peersRef.current.size);

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        void postSignal(slug, viewerId, CAMERA_INBOX_ADDRESS, "ice", {
          candidate: event.candidate.toJSON(),
        }).catch(() => {});
      };

      pc.ondatachannel = (event) => {
        event.channel.onmessage = (message) => {
          try {
            void runCommand(JSON.parse(String(message.data)) as Command);
          } catch {
            // A message we cannot read is not worth breaking the stream over.
          }
        };
      };

      pc.onconnectionstatechange = () => {
        if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
          dropPeer(viewerId);
        }
      };

      await pc.setRemoteDescription(offer);
      const local = await pc.createAnswer();
      await pc.setLocalDescription(local);
      await postSignal(slug, viewerId, CAMERA_INBOX_ADDRESS, "answer", {
        description: local,
      });
    },
    [dropPeer, iceServers, runCommand, slug],
  );

  /** The polling loop and the heartbeat, both running only while live. */
  useEffect(() => {
    if (!running) return;
    runningRef.current = true;
    let timer: ReturnType<typeof setTimeout>;

    const beat = async () => {
      let battery: number | null = null;
      try {
        const source = (
          navigator as Navigator & {
            getBattery?: () => Promise<{ level: number }>;
          }
        ).getBattery;
        if (source)
          battery = Math.round((await source.call(navigator)).level * 100);
      } catch {
        // Safari does not offer this. The camera works the same without it.
      }
      await fetch("/api/dogcam/cameras", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug,
          name,
          status: {
            streaming: streamRef.current !== null,
            facing: facingRef.current,
            battery,
            watchers: peersRef.current.size,
          },
        }),
      }).catch(() => {});
    };

    const poll = async () => {
      try {
        const { signals, cursor } = await fetchSignals(
          slug,
          CAMERA_INBOX_ADDRESS,
          cursorRef.current,
        );
        cursorRef.current = cursor;
        for (const signal of signals) {
          if (signal.kind === "offer") {
            await answer(
              signal.sender,
              signal.payload.description as RTCSessionDescriptionInit,
            );
          } else if (signal.kind === "ice") {
            const peer = peersRef.current.get(signal.sender);
            await peer?.pc
              .addIceCandidate(signal.payload.candidate as RTCIceCandidateInit)
              .catch(() => {});
          } else if (signal.kind === "bye") {
            dropPeer(signal.sender);
          }
        }
        setError(null);
        return signals.length > 0 ? POLL_BUSY_MS : POLL_IDLE_MS;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        return POLL_IDLE_MS * 2;
      }
    };

    const loop = async () => {
      const delay = await poll();
      if (runningRef.current) timer = setTimeout(loop, delay);
    };

    void beat();
    const heart = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
    void loop();

    return () => {
      runningRef.current = false;
      clearTimeout(timer);
      clearInterval(heart);
    };
  }, [answer, dropPeer, name, running, slug]);

  const start = async () => {
    setError(null);
    try {
      await openCamera();
      wakeRef.current = await holdScreenAwake();
      setPaused(false);
      setRunning(true);
    } catch (caught) {
      setError(explainCameraFailure(caught));
    }
  };

  const stop = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    setWatchers(0);
    for (const id of [...peersRef.current.keys()]) {
      void postSignal(slug, id, CAMERA_INBOX_ADDRESS, "bye", {}).catch(() => {});
      dropPeer(id);
    }
    releaseCamera();
    wakeRef.current?.release();
    wakeRef.current = null;
  }, [dropPeer, releaseCamera, slug]);

  // Leaving the page should put the camera light out, not leave it running in
  // a tab nobody can see.
  useEffect(() => () => stop(), [stop]);

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="relative aspect-video bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
          />
          {!running && (
            <div className="absolute inset-0 grid place-items-center text-sm text-white/70">
              Camera off
            </div>
          )}
          {running && paused && (
            <div className="absolute inset-0 grid place-items-center bg-black/80 text-sm text-white/80">
              Paused from the other end
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-edge p-3 text-sm">
          <span className="text-muted">
            {running
              ? watchers === 0
                ? "Live, nobody watching"
                : `${watchers} watching`
              : "Not running"}
          </span>
          {running ? (
            <button type="button" className="btn" onClick={stop}>
              Stop
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={start}>
              Start camera
            </button>
          )}
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="card border-red-500/40 p-4 text-sm text-red-500"
        >
          {error}
        </p>
      )}

      {running && (
        <div className="flex gap-2">
          <button
            type="button"
            className="btn flex-1"
            onClick={() => void runCommand({ action: "flip" })}
          >
            Flip lens
          </button>
          <button
            type="button"
            className="btn flex-1"
            onClick={() =>
              void runCommand({ action: paused ? "resume" : "pause" })
            }
          >
            {paused ? "Resume" : "Pause"}
          </button>
        </div>
      )}

      <div className="card space-y-2 p-4 text-sm text-muted">
        <p className="font-medium text-ink">Leave this device like this</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Plugged in. Holding a camera open eats a battery in a few hours.
          </li>
          <li>
            Settings &rarr; Display &amp; Brightness &rarr; Auto-Lock &rarr;
            Never. A locked screen stops the camera, and nothing can switch it
            back on from outside.
          </li>
          <li>
            This page in front, no other app over it. Turning the brightness
            right down is fine -- the camera keeps running.
          </li>
          <li>Wi-Fi, not cellular, if you have the choice. Video adds up.</li>
        </ul>
        <p>
          <Link href="/dogcam" className="text-accent underline">
            Back to all cameras
          </Link>
        </p>
      </div>
    </div>
  );
}

/**
 * A refused camera is the one failure a reader will actually hit, and the
 * browser's own wording for it ("Permission denied") does not say that the fix
 * is in the address bar, or that a page served over plain http cannot ask at all.
 */
function explainCameraFailure(caught: unknown): string {
  const error = caught as { name?: string; message?: string };
  if (error?.name === "NotAllowedError") {
    return (
      "The browser would not hand over the camera. Tap the address bar, allow camera " +
      "and microphone for this site, then try again."
    );
  }
  if (error?.name === "NotFoundError") {
    return "This device says it has no camera the browser can use.";
  }
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "A browser only gives out the camera over https. Open this page on its https address.";
  }
  return error?.message ?? String(caught);
}
