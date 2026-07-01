'use client';

import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

/**
 * Custom hook to connect to Socket.io and optionally join a specific room.
 * @param {Object} options - configuration options
 * @param {string} [options.eventId] - if provided, joins the event room
 * @param {string} [options.groupId] - if provided, joins the group room
 * @returns {import('socket.io-client').Socket} the socket instance
 */
export function useSocket({ eventId, groupId } = {}) {
  const socketRef = useRef(null);

  useEffect(() => {
    // Initialize socket connection
    socketRef.current = io(SOCKET_URL, {
      transports: ['websocket'],
      // In a real app with cross-domain, we might need credentials if doing auth via socket,
      // but here we just need to join rooms which the backend allows openly.
    });

    const socket = socketRef.current;

    socket.on('connect', () => {
      console.log('Socket connected:', socket.id);
      
      // Join requested rooms upon connection
      if (eventId) {
        socket.emit('join_event', { eventId });
      }
      if (groupId) {
        socket.emit('join_group', { groupId });
      }
    });

    // Cleanup on unmount
    return () => {
      if (socket) {
        if (eventId) socket.emit('leave_event', { eventId });
        if (groupId) socket.emit('leave_group', { groupId });
        socket.disconnect();
      }
    };
  }, [eventId, groupId]);

  return socketRef.current;
}
