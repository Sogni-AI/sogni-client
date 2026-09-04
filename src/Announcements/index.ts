import ApiGroup from '../ApiGroup.js';
import { ApiResponse } from '../ApiClient/index.js';
import type { AppAlert } from '../ApiClient/WebSocketClient/events.js';

/**
 * Admin-authored in-app announcements — pinned banners and toasts composed in
 * the Sogni Admin Portal.
 *
 * The socket is the primary delivery path: subscribe to the `appAlert` event
 * (opt in with `socketEventSubscriptions: { appAlert: true }`) and the server
 * pushes announcements live AND replays any live pinned banner on connect, so a
 * user who was offline when one published still receives it.
 *
 * This REST surface covers the two moments the socket cannot:
 *  - `active()` at launch, before the socket has authenticated
 *  - `dismiss()`, which must persist per ACCOUNT rather than per device so a
 *    banner dismissed on one client stays dismissed on the next
 *
 * Full contract: `docs/app-alert-contract.md` in sogni-socket.
 */
class AnnouncementsApi extends ApiGroup {
  /**
   * Announcements currently live for the signed-in account, minus anything the
   * account has already dismissed.
   *
   * @param platform Optional `appSource` for this client (e.g. `'sogni-mac'`).
   *   Platform-scoped announcements only match when it is supplied — an
   *   announcement narrowed to macOS is deliberately withheld from a caller
   *   that cannot say what it is, rather than sent to everyone.
   */
  async active(platform?: string): Promise<AppAlert[]> {
    const res = await this.client.rest.get<ApiResponse<{ announcements: AppAlert[] }>>(
      '/v1/announcements/active',
      platform ? { platform } : undefined
    );
    return res.data.announcements || [];
  }

  /**
   * Dismiss one announcement for the signed-in account, on every device.
   * Call this when the user closes a pinned announcement.
   */
  async dismiss(id: string): Promise<void> {
    await this.client.rest.post<ApiResponse<{ dismissed: boolean; id: string }>>(
      `/v1/announcements/${encodeURIComponent(id)}/dismiss`
    );
  }
}

export default AnnouncementsApi;
