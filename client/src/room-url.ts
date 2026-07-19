const ROOM_ROUTE = /\/r\/([^/]+)\/?$/;
const ROOM_SCOPED_QUERY_KEYS = Object.freeze([
  "room",
  "create",
  "name",
  "mode",
  "gravity",
  "ladder",
  "map",
]);

export function roomIdFromUrl(pathname: string, search: string): string {
  const routeMatch = ROOM_ROUTE.exec(pathname);
  if (routeMatch?.[1] !== undefined) {
    try {
      return decodeURIComponent(routeMatch[1]);
    } catch {
      return "";
    }
  }
  return new URLSearchParams(search).get("room") ?? "";
}

export function canonicalRoomUrl(currentHref: string, roomId: string): string {
  const url = new URL(currentHref);
  const basePath = url.pathname.replace(ROOM_ROUTE, "").replace(/\/$/, "");
  url.pathname = `${basePath}/r/${encodeURIComponent(roomId)}`;
  for (const key of ROOM_SCOPED_QUERY_KEYS) url.searchParams.delete(key);
  return url.toString();
}
