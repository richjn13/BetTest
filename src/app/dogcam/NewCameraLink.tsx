"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { slugify } from "@/lib/dogcam-client";

/**
 * Setting a device up as a camera is nothing more than opening its page, so
 * this is a name box and a link. Naming happens here rather than on the camera
 * page because the name is also the address: /dogcam/cam/living-room.
 */
export function NewCameraLink() {
  const router = useRouter();
  const [name, setName] = useState("");

  const slug = slugify(name);

  return (
    <form
      className="card space-y-3 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        router.push(
          `/dogcam/cam/${slug}?name=${encodeURIComponent(name.trim())}`,
        );
      }}
    >
      <div>
        <label className="label" htmlFor="camera-name">
          Use this device as a camera
        </label>
        <input
          id="camera-name"
          className="field"
          placeholder="Living room"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <button type="submit" className="btn w-full" disabled={!name.trim()}>
        Set up as camera
      </button>
      <p className="text-sm text-muted">
        Do this on the device you are leaving at home, not the one you will be
        watching from. Opening the same name again takes over that camera.
      </p>
    </form>
  );
}
