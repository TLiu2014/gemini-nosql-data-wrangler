import { useState, useEffect, useCallback } from "react";

export type MicPermissionState = "prompt" | "granted" | "denied" | "requesting";

export function useMicPermission() {
  const [state, setState] = useState<MicPermissionState>("prompt");

  // Check current permission status on mount
  useEffect(() => {
    if (!navigator.permissions) return;

    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((result) => {
        setState(result.state as MicPermissionState);
        result.onchange = () => {
          setState(result.state as MicPermissionState);
        };
      })
      .catch(() => {
        // permissions API not supported for mic in some browsers — stay at "prompt"
      });
  }, []);

  const request = useCallback(async (): Promise<boolean> => {
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Got permission — stop the test stream immediately
      stream.getTracks().forEach((t) => t.stop());
      setState("granted");
      return true;
    } catch {
      setState("denied");
      return false;
    }
  }, []);

  return { state, request };
}
