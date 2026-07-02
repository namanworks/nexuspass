"use client";

import { useEffect, useRef } from "react";
import { io } from "socket.io-client";

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export function useSocket({ eventId, groupId } = {}) {
  const socketRef = useRef(null);

  useEffect(() => {
    socketRef.current = io(SOCKET_URL, {
      transports: ["websocket"],
    });

    const socket = socketRef.current;

    socket.on("connect", () => {
      console.log("Socket connected:", socket.id);
      if (eventId) socket.emit("join_event", { eventId });
      if (groupId) socket.emit("join_group", { groupId });
    });

    return () => {
      if (socket) {
        if (eventId) socket.emit("leave_event", { eventId });
        if (groupId) socket.emit("leave_group", { groupId });
        socket.disconnect();
      }
    };
  }, [eventId, groupId]);

  return socketRef.current;
}
