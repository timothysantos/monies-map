export function isShortcutGatewayRequestAllowed(
  shortcutApiOnly: string | undefined,
  pathname: string,
  shortcutEndpointPath: string
) {
  return shortcutApiOnly !== "true" || pathname === shortcutEndpointPath;
}

export function isShortcutCreateRequestAllowed(
  pathname: string,
  method: string,
  shortcutEndpointPath: string
) {
  return pathname !== shortcutEndpointPath || method === "POST";
}

export function buildShortcutAppUrl(
  pathname: string,
  requestUrl: string,
  configuredAppOrigin?: string
) {
  return new URL(pathname, configuredAppOrigin?.trim() || requestUrl);
}
