"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CAMERA_INBOX_ADDRESS,
  fetchSignals,
  postSignal,
  randomId,
  type Command,
  type IceServer,
} from "@/lib/dogcam-client";

/**
 * The watching end. It asks the camera for a picture, and once the two are
 * talking directly it stops using the server entirely -- the pause and flip
 * buttons go down the same connection as the video.
 */

const POLL_MS = 1_000;
/** How long to wait before saying the camera is not there, rather than slow. */
const NO_ANSWER_MS = 12_000;

type Phase = "idle" | "calling" | "live" | "lost";

export function ViewerStage({
  slug,
  name,
  iceServers,
}: {
  slug: string;
  name: string;
  iceServers: IceServer[];
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const meRef = useRef<string>(randomId());
  const cursorRef = useRef(0);
  const pollingRef = useRef(false);
  /**
   * Candidates can arrive in the same breath as the answer, and one added
   * before the answer is set is thrown away by the browser. Holding them costs
   * nothing and is the difference between connecting and not.
   */
  const pendingRef = useRef<RTCIceCandidateInit[]>([]);

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sound, setSound] = useState(false);
  const [paused, setPaused] = useState(false);

  const send = useCallback((command: Command) => {
    const channel = channelRef.current;
    if (!channel || channel.readyState !== "open") {
      setError("Not connected to the camera yet.");
      return;
    }
    channel.send(JSON.stringify(command));
    if (command.action === "pause") setPaused(true);
    if (command.action === "resume" || command.action === "flip")
      setPaused(false);
  }, []);

  const teardown = useCallback(() => {
    pollingRef.current = false;
    channelRef.current?.close();
    channelRef.current = null;
    if (pcRef.current) {
      void postSignal(
        slug,
        CAMERA_INBOX_ADDRESS,
        meRef.current,
        "bye",
        {},
      ).catch(() => {});
      pcRef.current.close();
      pcRef.current = null;
    }
  }, [slug]);

  const teardownRef = useRef(teardown);
  teardownRef.current = teardown;

  const connect = useCallback(async () => {
    teardown();
    setError(null);
    setPhase("calling");
    cursorRef.current = 0;
    pendingRef.current = [];
    meRef.current = randomId();

    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;

    // Asking to receive only: this end has no camera of its own to offer.
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    const channel = pc.createDataChannel("control");
    channelRef.current = channel;

    pc.ontrack = (event) => {
      if (videoRef.current && event.streams[0]) {
        videoRef.current.srcObject = event.streams[0];
      }
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      void postSignal(slug, CAMERA_INBOX_ADDRESS, meRef.current, "ice", {
        candidate: event.candidate.toJSON(),
      }).catch(() => {});
    };

    pc.onconnectionstatechange = () => {
      if (pc !== pcRef.current) return;
      if (pc.connectionState === "connected") {
        setPhase("live");
        pollingRef.current = false; // Nothing left for the server to carry.
      }
      if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
        setPhase("lost");
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await postSignal(slug, CAMERA_INBOX_ADDRESS, meRef.current, "offer", {
      description: offer,
    });

    pollingRef.current = true;
    const startedAt = Date.now();

    const loop = async () => {
      if (!pollingRef.current || pc !== pcRef.current) return;
      try {
        const { signals, cursor } = await fetchSignals(
          slug,
          meRef.current,
          cursorRef.current,
        );
        cursorRef.current = cursor;
        for (const signal of signals) {
          if (signal.kind === "answer") {
            await pc.setRemoteDescription(
              signal.payload.description as RTCSessionDescriptionInit,
            );
            for (const candidate of pendingRef.current.splice(0)) {
              await pc.addIceCandidate(candidate).catch(() => {});
            }
          } else if (signal.kind === "ice") {
            const candidate = signal.payload.candidate as RTCIceCandidateInit;
            if (pc.remoteDescription) {
              await pc.addIceCandidate(candidate).catch(() => {});
            } else {
              pendingRef.current.push(candidate);
            }
          } else if (signal.kind === "bye") {
            setPhase("lost");
            setError("The camera was stopped at the other end.");
          }
        }
        if (!pc.remoteDescription && Date.now() - startedAt > NO_ANSWER_MS) {
          setError(
            "The camera is not answering. The device at home is asleep, or its camera " +
              "page is closed or covered by another app.",
          );
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
      if (pollingRef.current) setTimeout(() => void loop(), POLL_MS);
    };

    void loop();
  }, [iceServers, slug, teardown]);

  // Connect once. `connect` is rebuilt on every render, and depending on it
  // here would mean redialling the camera on every state change.
  const connectRef = useRef(connect);
  connectRef.current = connect;
  useEffect(() => {
    void connectRef.current();
    return () => teardownRef.current();
  }, []);

  // Autoplay with sound is refused everywhere, so the picture starts silent and
  // the sound is a deliberate tap.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = !sound;
  }, [sound]);

  const snapshot = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/jpeg", 0.9);
    link.download = `${slug}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.jpg`;
    link.click();
  };

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="relative aspect-video bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-contain"
          />
          {phase !== "live" && (
            <div className="absolute inset-0 grid place-items-center text-sm text-white/70">
              {phase === "calling"
                ? "Connecting to the camera..."
                : "Not connected"}
            </div>
          )}
          {phase === "live" && paused && (
            <div className="absolute inset-0 grid place-items-center bg-black/80 text-sm text-white/80">
              Camera paused
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-edge p-3 text-sm">
          <span className="text-muted">
            {phase === "live"
              ? "Live"
              : phase === "calling"
                ? "Calling"
                : "Off"}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn"
              onClick={() => setSound((on) => !on)}
            >
              {sound ? "Mute" : "Sound"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void connect()}
            >
              Reconnect
            </button>
          </div>
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

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          className="btn"
          disabled={phase !== "live"}
          onClick={() => send({ action: paused ? "resume" : "pause" })}
        >
          {paused ? "Turn on" : "Turn off"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={phase !== "live"}
          onClick={() => send({ action: "flip" })}
        >
          Flip lens
        </button>
        <button
          type="button"
          className="btn"
          disabled={phase !== "live"}
          onClick={snapshot}
        >
          Snapshot
        </button>
      </div>

      <p className="text-sm text-muted">
        Turning the camera off stops it at the other end -- the light goes out
        and nothing is being sent. Turn it back on from here whenever you like,
        as long as that device is still awake on its camera page.
      </p>

      <p className="text-sm">
        <Link href="/dogcam" className="text-accent underline">
          Back to all cameras
        </Link>
        <span className="text-muted"> &middot; watching {name}</span>
      </p>
    </div>
  );
}
