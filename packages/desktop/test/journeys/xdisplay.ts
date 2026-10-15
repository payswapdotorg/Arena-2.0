import net from "node:net";

/**
 * UIA-006 — X display probe (issue #80).
 *
 * The Electron journeys need a real X server (Xvfb at station :99). This probe
 * performs a REAL X11 connection handshake (byte-order + protocol version
 * request, server success reply) against the display referenced by DISPLAY —
 * honest NOT_SUPPORTED when no display answers. A stale socket file or a dead
 * Xvfb fails the handshake here (never a silent pass).
 */

export interface XDisplayProbe {
  /** The display string the journeys will export as DISPLAY for Electron. */
  display: string | null;
  /** Where the probed display came from. */
  source: string;
  /** Per-candidate probe outcomes (recorded verbatim in the transcript). */
  candidates: ReadonlyArray<{ display: string; transport: string; alive: boolean; detail: string }>;
}

const STATION_DEFAULT_DISPLAY = ":99";

/** One X11 connection-setup handshake against a connectable socket. */
function handshake(connect: () => net.Socket): Promise<{ alive: boolean; detail: string }> {
  return new Promise((accept) => {
    const socket = connect();
    let settled = false;
    const finish = (alive: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      accept({ alive, detail });
    };
    const timer = setTimeout(() => finish(false, "timeout after 2000ms"), 2_000);
    socket.on("error", (error) => finish(false, `connect error: ${error.message}`));
    socket.on("connect", () => {
      // X11 connection setup: byte-order 'l' (little-endian), unused 0,
      // protocol-major 11, protocol-minor 0, auth name/data lengths 0, pad.
      socket.write(
        Buffer.from([0x6c, 0x00, 0x0b, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
      );
    });
    socket.on("data", (chunk: Buffer) => {
      const reply = chunk[0];
      finish(
        reply === 1,
        reply === 1
          ? "X11 handshake ok (server success reply)"
          : `X11 server replied non-success (${reply}) — access control or protocol refusal`,
      );
    });
  });
}

interface DisplayEndpoint {
  transport: "unix" | "tcp";
  connect: () => net.Socket;
  detail: string;
}

function endpointFor(display: string): DisplayEndpoint | null {
  const match = /^(?:(unix|[^:]*))?:(\d+)(?:\.\d+)?$/u.exec(display.trim());
  if (match === null) return null;
  const host = match[1] ?? "";
  const displayNumber = Number.parseInt(match[2] ?? "", 10);
  if (Number.isNaN(displayNumber)) return null;
  if (host === "" || host === "unix") {
    const socketPath = `/tmp/.X11-unix/X${displayNumber}`;
    return {
      transport: "unix",
      connect: () => net.createConnection(socketPath),
      detail: `unix socket ${socketPath}`,
    };
  }
  const port = 6000 + displayNumber;
  return {
    transport: "tcp",
    connect: () => net.createConnection({ host, port }),
    detail: `tcp ${host}:${port}`,
  };
}

async function probeOne(display: string): Promise<{
  display: string;
  transport: string;
  alive: boolean;
  detail: string;
}> {
  const endpoint = endpointFor(display);
  if (endpoint === null) {
    return { display, transport: "none", alive: false, detail: "unparsable DISPLAY value" };
  }
  const result = await handshake(endpoint.connect);
  return {
    display,
    transport: endpoint.transport,
    alive: result.alive,
    detail: `${endpoint.detail} — ${result.detail}`,
  };
}

/**
 * Probe the X display for the journeys: DISPLAY if set, then the documented
 * station default (:99) as a fallback candidate (the substitution is recorded
 * honestly — never silent). Returns the first ALIVE display or null.
 */
export async function probeXDisplay(): Promise<XDisplayProbe> {
  const requested = process.env.DISPLAY?.trim() ?? "";
  const candidates = requested === "" || requested === STATION_DEFAULT_DISPLAY
    ? [requested === "" ? STATION_DEFAULT_DISPLAY : requested]
    : [requested, STATION_DEFAULT_DISPLAY];
  const outcomes: Array<{ display: string; transport: string; alive: boolean; detail: string }> = [];
  for (const candidate of candidates) {
    const outcome = await probeOne(candidate);
    outcomes.push(outcome);
    if (outcome.alive) {
      return {
        display: candidate,
        source:
          requested === ""
            ? `DISPLAY unset — fell back to the station default ${STATION_DEFAULT_DISPLAY} (alive)`
            : candidate === requested
              ? "DISPLAY from the environment (alive)"
              : `DISPLAY=${requested} unresolvable — substituted the station default ${STATION_DEFAULT_DISPLAY} (alive)`,
        candidates: outcomes,
      };
    }
  }
  return {
    display: null,
    source:
      requested === ""
        ? `DISPLAY unset and the station default ${STATION_DEFAULT_DISPLAY} did not answer`
        : `DISPLAY=${requested} unresolvable and the station default ${STATION_DEFAULT_DISPLAY} did not answer`,
    candidates: outcomes,
  };
}
