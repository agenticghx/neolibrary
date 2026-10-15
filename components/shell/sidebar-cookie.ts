/**
 * The cookie that remembers whether the sidebar is hidden on this device (M24). In its own file because
 * the server layout reads it: a constant imported from a "use client" file is not the value on the server.
 */
export const SIDEBAR_COOKIE = "nl.sidebar";
