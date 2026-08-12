import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { DraftController, DraftSnapshotDto } from "../draft/draft-controller.js";

export interface DraftHub {
  readonly path: string;
  broadcast(snapshot: DraftSnapshotDto): void;
  close(): void;
}

export function attachDraftWebSocket(server: Server, controller: DraftController, path = "/ws/draft"): DraftHub {
  const wss = new WebSocketServer({ server, path });
  const clients = new Set<WebSocket>();

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify(controller.currentSnapshot()));
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });

  return {
    path,
    broadcast(snapshot: DraftSnapshotDto): void {
      const message = JSON.stringify(snapshot);
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(message);
      }
    },
    close(): void {
      for (const ws of clients) ws.terminate();
      wss.close();
    }
  };
}
