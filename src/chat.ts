import { CONFIG } from "./config";

export interface PageSearchMatch {
  text: string;
  context: string;
  start: number;
  end: number;
}
export interface PageSearchResult {
  query: string;
  matches: PageSearchMatch[];
}
export interface ChatMessage {
  id?: number;
  createdAt?: string;
  isUserMessage: boolean;
  messageText: string;
  pageReferences?: string[];
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] || c,
  );
}

function appendInlineMarkdown(
  parent: HTMLElement,
  value: string,
  refs: string[],
  onReference: (ref: string) => void,
): void {
  for (const part of value.split(/(\[\d+\])/g)) {
    const match = part.match(/^\[(\d+)\]$/);
    if (match && refs[Number(match[1]) - 1]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chat-reference";
      button.textContent = part;
      button.title = "Find this text on the page";
      button.addEventListener("click", () =>
        onReference(refs[Number(match[1]) - 1]),
      );
      parent.appendChild(button);
      continue;
    }
    const span = document.createElement("span");
    span.innerHTML = escapeHtml(part)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(
        /(https:\/\/[^\s<]+)/g,
        '<a href="$1" target="_blank" rel="noreferrer">$1</a>',
      );
    parent.appendChild(span);
  }
}

function renderMarkdown(
  value: string,
  refs: string[],
  onReference: (ref: string) => void,
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  let list: HTMLOListElement | HTMLUListElement | null = null;
  let inCode = false;
  let code = "";
  const closeList = () => {
    if (list) {
      fragment.appendChild(list);
      list = null;
    }
  };
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        const pre = document.createElement("pre");
        pre.className = "chat-code";
        pre.textContent = code.trimEnd();
        fragment.appendChild(pre);
        code = "";
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      code += `${line}\n`;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (heading) {
      closeList();
      const element = document.createElement(`h${heading[1].length}`);
      appendInlineMarkdown(element, heading[2], refs, onReference);
      fragment.appendChild(element);
      continue;
    }
    if (bullet || ordered) {
      if (
        !list ||
        (ordered && list.tagName !== "OL") ||
        (bullet && list.tagName !== "UL")
      ) {
        closeList();
        list = document.createElement(ordered ? "ol" : "ul");
      }
      const item = document.createElement("li");
      appendInlineMarkdown(item, (bullet || ordered)![1], refs, onReference);
      list.appendChild(item);
      continue;
    }
    closeList();
    if (!line.trim()) continue;
    const paragraph = document.createElement("p");
    appendInlineMarkdown(paragraph, line, refs, onReference);
    fragment.appendChild(paragraph);
  }
  closeList();
  if (inCode && code) {
    const pre = document.createElement("pre");
    pre.className = "chat-code";
    pre.textContent = code.trimEnd();
    fragment.appendChild(pre);
  }
  return fragment;
}

export class ChatController {
  private chatId: number | null = null;
  private messages: ChatMessage[] = [];
  private socket: WebSocket | null = null;
  private container: HTMLElement | null = null;
  private pageUrl = "";
  private loading = false;
  private historyLoading = false;
  private statusMessage = "";

  async render(container: HTMLElement, pageUrl: string): Promise<void> {
    this.container = container;
    this.pageUrl = pageUrl;
    container.innerHTML = `<style>
      .chat-root{display:flex;flex-direction:column;height:100%;box-sizing:border-box;background:linear-gradient(180deg,#141414 0%,#111 100%)}
      .chat-messages{flex:1;overflow-y:auto;padding:18px 16px 10px;scroll-behavior:smooth}.chat-empty{height:100%;display:flex;align-items:center;justify-content:center;text-align:center;color:#888;font-size:12px;padding:30px}.chat-empty strong{display:block;color:#ddd;font-size:15px;margin-bottom:7px}.chat-empty-logo{display:block;width:52px;height:52px;margin:0 auto 18px}
      .chat-row{display:flex;margin:0 0 14px}.chat-row.user{justify-content:flex-end}.chat-row.assistant{align-items:flex-start;gap:8px;margin-top:20px}.chat-message{max-width:88%;padding:11px 13px;border-radius:14px;color:#ddd;font-size:13px;line-height:1.55;overflow-wrap:anywhere}.chat-message.user{background:#28543a;color:#f2fff5;border-bottom-right-radius:4px}.chat-assistant-icon{width:22px;height:22px;flex:0 0 22px;margin-top:2px}.chat-assistant-icon svg{display:block;width:100%;height:100%}.chat-assistant-content{max-width:88%;min-width:0}.chat-message.assistant{max-width:none;padding:0;background:transparent;border:0;border-radius:0}.chat-message p{margin:0 0 9px}.chat-message p:last-child{margin-bottom:0}.chat-message h1,.chat-message h2,.chat-message h3{color:#f1f1f1;line-height:1.25;margin:2px 0 9px}.chat-message h1{font-size:17px}.chat-message h2{font-size:15px}.chat-message h3{font-size:14px}.chat-message ul,.chat-message ol{margin:5px 0 9px;padding-left:20px}.chat-message li{padding-left:3px;margin:3px 0}.chat-message code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;background:#111;border-radius:4px;padding:2px 4px}.chat-code{white-space:pre-wrap;background:#111;border:1px solid #333;border-radius:7px;padding:10px;margin:5px 0;font-size:11px;overflow:auto}.chat-message a{color:#9bd6aa}.chat-reference{border:0;padding:0 3px;background:transparent;color:#9bd6aa;font-weight:700;cursor:pointer}.chat-reference:hover{text-decoration:underline}.chat-reference.not-found{color:#e8a3a3}.chat-copy{display:inline-flex;align-items:center;gap:5px;margin-top:2px;padding:3px 0;border:0;background:transparent;color:#777;font:inherit;font-size:10px;cursor:pointer}.chat-copy svg{width:12px;height:12px}.chat-copy:hover,.chat-copy:focus-visible{color:#b8d9bf}.chat-copy.copied{color:#6eb781}
      .chat-thinking{display:flex;align-items:center;gap:5px;color:#999;font-size:11px;padding:8px 12px}.chat-thinking i{width:5px;height:5px;background:#6eb781;border-radius:50%;animation:chat-bounce 1s infinite}.chat-thinking i:nth-child(2){animation-delay:.15s}.chat-thinking i:nth-child(3){animation-delay:.3s}@keyframes chat-bounce{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-4px);opacity:1}}
      .chat-status{margin:0 16px 8px;padding:8px 10px;border-radius:7px;background:rgba(210,100,100,.12);color:#eca9a9;font-size:11px}.chat-form{display:flex;align-items:flex-end;gap:8px;padding:12px 14px 14px;border-top:1px solid rgba(255,255,255,.08);flex-shrink:0}.chat-form textarea{flex:1;min-width:0;min-height:38px;max-height:120px;resize:none;padding:10px 11px;border:1px solid #3b3b3b;border-radius:9px;background:#191919;color:#eee;font:inherit;font-size:12px;line-height:1.4;outline:none}.chat-form textarea:focus{border-color:#6eb781}.chat-form textarea:disabled{opacity:.6}.chat-send{width:38px;height:38px;border:0;border-radius:9px;background:#6eb781;color:#08130b;cursor:pointer;font-weight:700}.chat-send:hover{background:#86cb98}.chat-send:disabled{cursor:default;opacity:.45}
    </style><div class="chat-root"><div class="chat-messages"></div><div class="chat-status" hidden></div><form class="chat-form"><textarea rows="1" placeholder="Ask about this page…" autocomplete="off"></textarea><button class="chat-send" type="submit" aria-label="Send message">↑</button></form></div>`;
    const textarea = container.querySelector(
      "textarea",
    ) as HTMLTextAreaElement | null;
    textarea?.addEventListener("input", () => {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    });
    await this.loadHistory();
    container.querySelector("form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (textarea?.value.trim()) {
        const text = textarea.value.trim();
        textarea.value = "";
        textarea.style.height = "auto";
        void this.send(text);
      }
    });
    textarea?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        textarea.form?.requestSubmit();
      }
    });
  }

  private async loadHistory(): Promise<void> {
    this.historyLoading = true;
    this.statusMessage = "";
    this.paint();
    const token = await this.authToken();
    if (!token || !this.container) {
      this.historyLoading = false;
      this.statusMessage = "Sign in to use chat";
      this.paint();
      return;
    }
    try {
      const data = await chrome.runtime.sendMessage({
        type: "FETCH_CHAT",
        data: { url: this.pageUrl },
      });
      if (data?.error) throw new Error(data.error);
      this.chatId = data.chatId;
      this.messages = Array.isArray(data.messages) ? data.messages : [];
      this.historyLoading = false;
      this.paint();
    } catch (error) {
      this.historyLoading = false;
      this.statusMessage = (error as Error).message;
      this.paint();
    }
  }

  private async send(text: string): Promise<void> {
    if (!this.chatId || this.loading) return;
    this.statusMessage = "";
    this.messages.push({ isUserMessage: true, messageText: text });
    this.loading = true;
    this.paint();
    try {
      const token = await this.authToken();
      if (!token) throw new Error("Sign in to use chat");
      const port = chrome.runtime.connect({ name: "scholic-chat" });
      await new Promise<void>((resolve, reject) => {
        port.onMessage.addListener((message) => {
          if (message.type === "tool_call")
            void this.handleToolCall(message.toolCall, port);
          if (message.type === "assistant_message") {
            this.messages.push(message.message);
            this.loading = false;
            this.paint();
            port.postMessage({ type: "CLOSE" });
            port.disconnect();
            resolve();
          }
          if (message.type === "error") {
            port.disconnect();
            reject(new Error(message.error));
          }
          if (message.type === "closed" && this.loading) {
            reject(new Error("Chat connection closed"));
          }
        });
        port.onDisconnect.addListener(() => {
          if (this.loading) reject(new Error("Chat connection closed"));
        });
        port.postMessage({ type: "CONNECT", chatId: this.chatId });
        port.postMessage({
          type: "SEND",
          payload: { messageText: text },
        });
      });
    } catch (error) {
      this.loading = false;
      this.showStatus((error as Error).message);
      this.paint();
    }
  }

  private async handleToolCall(
    call: any,
    port: chrome.runtime.Port,
  ): Promise<void> {
    const output =
      call.name === "SearchPageContent"
        ? searchPageContent(call.arguments?.query || "")
        : null;
    port.postMessage({
      type: "SEND",
      payload: {
        type: "tool_result",
        result: {
          toolCallId: call.id,
          name: call.name,
          output,
          error: output ? "" : "unsupported page tool",
        },
      },
    });
  }

  private paint(): void {
    const messages = this.container?.querySelector(".chat-messages");
    if (!messages) return;
    messages.innerHTML = "";
    if (this.historyLoading) {
      messages.innerHTML = `<div class="chat-empty"><div><strong>Loading chat…</strong>Getting your conversation ready.</div></div>`;
    } else if (!this.messages.length) {
      messages.innerHTML = `<div class="chat-empty"><div><svg class="chat-empty-logo" viewBox="0 0 56 56" fill="none" aria-label="Scholic logo"><circle cx="28" cy="10" r="5" fill="#E8C547"/><circle cx="42" cy="18" r="5" fill="#E87347"/><circle cx="44" cy="34" r="5" fill="#6EB781"/><circle cx="34" cy="46" r="5" fill="#47A3E8"/><circle cx="18" cy="44" r="5" fill="#9B6EB7"/><circle cx="12" cy="28" r="5" fill="#E8477A"/><circle cx="18" cy="16" r="5" fill="#47E8C5"/><circle cx="30" cy="28" r="3.5" fill="#6EB781"/></svg><strong>What would you like to know?</strong>Ask about the page content, summarize it, or find a detail.</div></div>`;
    }
    for (const message of this.messages) {
      const row = document.createElement("div");
      row.className = `chat-row ${message.isUserMessage ? "user" : "assistant"}`;
      const bubble = document.createElement("div");
      bubble.className = `chat-message ${message.isUserMessage ? "user" : "assistant"}`;
      if (message.isUserMessage) {
        bubble.textContent = message.messageText;
        row.appendChild(bubble);
      } else {
        const icon = document.createElement("div");
        icon.className = "chat-assistant-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.innerHTML = `<svg viewBox="0 0 56 56" fill="none"><circle cx="28" cy="10" r="5" fill="#E8C547"/><circle cx="42" cy="18" r="5" fill="#E87347"/><circle cx="44" cy="34" r="5" fill="#6EB781"/><circle cx="34" cy="46" r="5" fill="#47A3E8"/><circle cx="18" cy="44" r="5" fill="#9B6EB7"/><circle cx="12" cy="28" r="5" fill="#E8477A"/><circle cx="18" cy="16" r="5" fill="#47E8C5"/><circle cx="30" cy="28" r="3.5" fill="#6EB781"/></svg>`;
        bubble.appendChild(
          renderMarkdown(
            message.messageText,
            message.pageReferences || [],
            (ref) => this.findReference(ref),
          ),
        );
        const content = document.createElement("div");
        content.className = "chat-assistant-content";
        content.appendChild(bubble);
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "chat-copy";
        copy.setAttribute("aria-label", "Copy response");
        copy.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>Copy</span>`;
        copy.addEventListener(
          "click",
          () => void this.copyMessage(message.messageText, copy),
        );
        content.appendChild(copy);
        row.appendChild(icon);
        row.appendChild(content);
      }
      messages.appendChild(row);
    }
    if (this.loading) {
      messages.insertAdjacentHTML(
        "beforeend",
        `<div class="chat-thinking"><i></i><i></i><i></i><span>Thinking</span></div>`,
      );
    }
    const status = this.container?.querySelector(
      ".chat-status",
    ) as HTMLElement | null;
    if (status) {
      status.hidden = !this.statusMessage;
      status.textContent = this.statusMessage;
    }
    const textarea = this.container?.querySelector(
      "textarea",
    ) as HTMLTextAreaElement | null;
    const button = this.container?.querySelector(
      ".chat-send",
    ) as HTMLButtonElement | null;
    if (textarea) textarea.disabled = this.loading || this.historyLoading;
    if (button) button.disabled = this.loading || this.historyLoading;
    messages.scrollTop = messages.scrollHeight;
  }

  private findReference(reference: string): void {
    const found = window.find(reference, false, false, true);
    if (found)
      window
        .getSelection()
        ?.getRangeAt(0)
        .startContainer.parentElement?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
    else {
      this.statusMessage = "Reference not found on this page";
      this.paint();
    }
  }
  private showStatus(message: string): void {
    this.statusMessage = message;
    this.paint();
  }
  private async copyMessage(
    text: string,
    button: HTMLButtonElement,
  ): Promise<void> {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      button.classList.add("copied");
      button.setAttribute("aria-label", "Response copied");
      const label = button.querySelector("span");
      if (label) label.textContent = "Copied";
      window.setTimeout(() => {
        if (!button.isConnected) return;
        button.classList.remove("copied");
        button.setAttribute("aria-label", "Copy response");
        if (label) label.textContent = "Copy";
      }, 1500);
    } catch {
      this.showStatus("Could not copy response");
    }
  }
  private async authToken(): Promise<string | null> {
    const result = await chrome.storage.local.get("scholicToken");
    return result.scholicToken || null;
  }
}

export class ChatPanel {
  constructor(
    private controller: ChatController,
    private getPageUrl: () => string,
  ) {}
  render(container: HTMLElement): void {
    void this.controller.render(container, this.getPageUrl());
  }
}

export function searchPageContent(query: string): PageSearchResult {
  let blocks = Array.from(
    document.body.querySelectorAll<HTMLElement>(
      'article, main, section, [role="main"], h1, h2, h3, p, li, blockquote, pre',
    ),
  );
  if (!blocks.length)
    blocks = Array.from(document.body.querySelectorAll<HTMLElement>("div"));
  blocks = blocks.filter(
    (block) =>
      !block.closest(
        "scholic-sidebar-host, scholic-popover-host, scholic-quick-highlight-menu",
      ) && block.innerText.trim(),
  );
  const unique: HTMLElement[] = [];
  for (const block of blocks)
    if (
      !unique.some(
        (existing) => existing.contains(block) || block.contains(existing),
      )
    )
      unique.push(block);
  const needle = query.trim().toLowerCase();
  const matches: PageSearchMatch[] = [];
  for (let index = 0; index < unique.length; index++) {
    const text = unique[index].innerText.trim();
    if (!needle || text.toLowerCase().includes(needle)) {
      const context = unique
        .slice(Math.max(0, index - 1), Math.min(unique.length, index + 2))
        .map((item) => item.innerText.trim())
        .join("\n");
      const start = document.body.innerText.indexOf(text);
      matches.push({
        text,
        context,
        start: Math.max(0, start),
        end: Math.max(0, start) + text.length,
      });
    }
    if (matches.length >= 20) break;
  }
  return { query, matches };
}
