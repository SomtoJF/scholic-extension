/**
 * Chat panel UI.
 *
 * Kept separate from the sidebar so chat can grow without making the
 * annotation panel responsible for chat state and rendering.
 */
export class ChatPanel {
  render(container: HTMLElement): void {
    container.innerHTML = `
      <div class="empty-state" style="padding: 64px 28px;">
        <div style="font-size: 28px; margin-bottom: 14px;">💬</div>
        <div style="font-weight: 600; margin-bottom: 8px; color: #ddd;">Chat</div>
        <div style="font-size: 12px; line-height: 1.5;">Chat for this page is coming soon.</div>
      </div>
    `;
  }
}
