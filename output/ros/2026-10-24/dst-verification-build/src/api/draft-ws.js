import { WebSocket, WebSocketServer } from "ws";
export function attachDraftWebSocket(server, controller, path = "/ws/draft") {
    const wss = new WebSocketServer({ server, path });
    const clients = new Set();
    wss.on("connection", (ws) => {
        clients.add(ws);
        ws.send(JSON.stringify(controller.currentSnapshot()));
        ws.on("close", () => clients.delete(ws));
        ws.on("error", () => clients.delete(ws));
    });
    return {
        path,
        broadcast(snapshot) {
            const message = JSON.stringify(snapshot);
            for (const ws of clients) {
                if (ws.readyState === WebSocket.OPEN)
                    ws.send(message);
            }
        },
        close() {
            for (const ws of clients)
                ws.terminate();
            wss.close();
        }
    };
}
