"use client";
import { useCallback, useRef, useState } from "react";
import { createClient, AnamEvent } from "@anam-ai/js-sdk";

const VIDEO_ID = "jadwa-avatar-video";

interface UseAnamReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  isConnected: boolean;
  isSpeaking: boolean;
  initAnam: () => Promise<void>;
  streamText: (delta: string, isLast?: boolean) => void;
  stopAnam: () => Promise<void>;
}

export function useAnam(): UseAnamReturn {
  const videoRef       = useRef<HTMLVideoElement>(null);
  const clientRef      = useRef<ReturnType<typeof createClient> | null>(null);
  const talkStreamRef  = useRef<any>(null);
  const endSpeechTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking,  setIsSpeaking]  = useState(false);

  const initAnam = useCallback(async () => {
    const base = process.env.NEXT_PUBLIC_BACKEND_URL || "";
    const res = await fetch(`${base}/api/anam/token`, { method: "POST" });
    if (!res.ok) throw new Error("Failed to get Anam token");
    const data = await res.json();
    const sessionToken = data.sessionToken ?? data.session_token;

    const client = createClient(sessionToken, { disableInputAudio: true });

    client.addListener(AnamEvent.CONNECTION_ESTABLISHED, () => setIsConnected(true));
    client.addListener(AnamEvent.CONNECTION_CLOSED, () => {
      setIsConnected(false);
      setIsSpeaking(false);
      talkStreamRef.current = null;
    });
    client.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, (e: any) => {
      if (e?.endOfSpeech) {
        if (endSpeechTimer.current) clearTimeout(endSpeechTimer.current);
        endSpeechTimer.current = setTimeout(() => setIsSpeaking(false), 1500);
      } else {
        if (endSpeechTimer.current) { clearTimeout(endSpeechTimer.current); endSpeechTimer.current = null; }
      }
    });

    clientRef.current = client;
    if (videoRef.current) videoRef.current.id = VIDEO_ID;
    await client.streamToVideoElement(VIDEO_ID);
  }, []);

  const streamText = useCallback((delta: string, isLast?: boolean) => {
    if (!clientRef.current) return;

    if (!talkStreamRef.current || !talkStreamRef.current.isActive()) {
      if (!delta && isLast) return;
      talkStreamRef.current = clientRef.current.createTalkMessageStream();
      setIsSpeaking(true);
    }

    const stream = talkStreamRef.current;
    if (isLast) {
      stream.streamMessageChunk(delta || "", true)
        .then(() => { talkStreamRef.current = null; })
        .catch(() => { talkStreamRef.current = null; });
    } else if (delta) {
      stream.streamMessageChunk(delta, false).catch(console.error);
    }
  }, []);

  const stopAnam = useCallback(async () => {
    if (endSpeechTimer.current) { clearTimeout(endSpeechTimer.current); endSpeechTimer.current = null; }
    talkStreamRef.current = null;
    await clientRef.current?.stopStreaming();
    clientRef.current = null;
    setIsConnected(false);
    setIsSpeaking(false);
  }, []);

  return { videoRef, isConnected, isSpeaking, initAnam, streamText, stopAnam };
}
