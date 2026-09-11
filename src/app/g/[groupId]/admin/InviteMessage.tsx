"use client";

import { useEffect, useState } from "react";

/**
 * A ready-to-send invite. The text is editable before copying, so it can be
 * made to sound like the person sending it rather than like an app.
 *
 * The address is read from the browser rather than configured, so it is always
 * whatever the group is actually being used on.
 */
export function InviteMessage({
  groupName,
  joinCode,
}: {
  groupName: string;
  joinCode: string;
}) {
  const [origin, setOrigin] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    const here = window.location.origin;
    setOrigin(here);
    setCanShare(typeof navigator.share === "function");
    setMessage(compose(groupName, joinCode, here));
  }, [groupName, joinCode]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; selecting the text still works.
      setCopied(false);
    }
  }

  async function share() {
    try {
      await navigator.share({ text: message });
    } catch {
      // Cancelled, or unavailable. Nothing to report.
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Edit it if you like, then copy and send it however you normally would.
      </p>

      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        rows={11}
        spellCheck={false}
        aria-label="Invite message"
        className="field font-normal leading-relaxed"
      />

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className="btn-primary text-sm">
          {copied ? "Copied" : "Copy message"}
        </button>
        {canShare && (
          <button type="button" onClick={share} className="btn text-sm">
            Share
          </button>
        )}
        <button
          type="button"
          onClick={() => setMessage(compose(groupName, joinCode, origin))}
          className="btn text-sm text-muted"
        >
          Reset
        </button>
      </div>

      <p className="text-xs text-muted">
        The join code is in the message. Regenerating it under Group above
        invalidates any invite you have already sent.
      </p>
    </div>
  );
}

function compose(groupName: string, joinCode: string, origin: string): string {
  return [
    `Want in on the NFL pick'em? The pool is called ${groupName}.`,
    ``,
    `Every week you pick each game against the spread. One pick is your lock,`,
    `worth double if it lands. Most points over the season wins.`,
    ``,
    `Join here: ${origin}/join`,
    `Join code: ${joinCode}`,
    ``,
    `Pick a username and a 4 digit PIN when you sign up. The PIN is how you get`,
    `back in on another device, so keep it somewhere.`,
    ``,
    `Works best added to your phone's home screen.`,
  ].join("\n");
}
