import type { Selector } from './anchoring/types';
import type { AnnotationData } from './sidebar';
import { HIGHLIGHT_COLORS } from './sidebar';
import { CONFIG } from './config';
import { canonicalAnnotationUrl } from './url';

export interface AnnotationPopupCallbacks {
  onSave: (annotation: AnnotationData) => void;
  onCancel: () => void;
}

/** In-page composer used after selecting text. */
export class AnnotationPopup {
  private host: HTMLElement | null = null;
  private callbacks: AnnotationPopupCallbacks;

  constructor(callbacks: AnnotationPopupCallbacks) {
    this.callbacks = callbacks;
  }

  show(rect: DOMRect, quoteText: string, selectors: Selector[], isAuthenticated: boolean, url?: string): void {
    this.hide();

    this.host = document.createElement('scholic-annotation-popup-host');
    this.host.style.cssText = 'position:absolute;z-index:2147483647;';
    const shadow = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .popup { width: 320px; padding: 14px; box-sizing: border-box; background: #171717; color: #eee;
        border: 1px solid rgba(255,255,255,.13); border-radius: 12px; box-shadow: 0 14px 40px rgba(0,0,0,.42);
        font: 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      .quote { max-height: 54px; overflow: hidden; margin-bottom: 10px; padding: 8px 10px; border-left: 3px solid #6EB781;
        background: rgba(110,183,129,.10); color: #bbb; line-height: 1.4; }
      textarea { width: 100%; min-height: 72px; max-height: 180px; resize: vertical; box-sizing: border-box; padding: 9px 10px;
        border: 1px solid rgba(255,255,255,.14); border-radius: 8px; outline: none; background: #222; color: #fff; font: inherit; }
      textarea:focus { border-color: rgba(110,183,129,.7); }
      .row { display:flex; align-items:center; gap:7px; margin-top:10px; }
      .label { color:#888; font-size:11px; margin-right:2px; }
      .swatch { width:17px; height:17px; padding:0; border:1px solid rgba(255,255,255,.2); border-radius:50%; cursor:pointer; }
      .swatch.active { outline:2px solid #fff; outline-offset:2px; }
      .privacy { margin-left:auto; border:0; background:transparent; color:#aaa; cursor:pointer; font:inherit; font-size:11px; }
      .actions { display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
      button.action { border:0; border-radius:7px; padding:7px 12px; cursor:pointer; font:600 12px inherit; }
      .cancel { color:#aaa; background:transparent; } .save { color:#fff; background:#6EB781; }
      .login { line-height:1.45; color:#bbb; } .login strong { display:block; color:#fff; margin-bottom:5px; }
      .login button { width:100%; margin-top:12px; border:0; border-radius:7px; padding:8px; color:#fff; background:#6EB781; cursor:pointer; font-weight:600; }
    `;
    shadow.appendChild(style);

    const popup = document.createElement('div');
    popup.className = 'popup';
    if (!isAuthenticated) {
      popup.innerHTML = `<div class="login"><strong>Sign in to annotate</strong>Save highlights and join the conversation with Scholic.<button type="button">Sign in to Scholic</button></div>`;
      popup.querySelector('button')?.addEventListener('click', () => {
        window.open(`${CONFIG.WEB_URL}/auth/extension-login?extId=${chrome.runtime.id}`, '_blank');
        this.hide();
      });
      shadow.appendChild(popup);
      this.mount(rect, popup);
      return;
    }

    let selectedColor = HIGHLIGHT_COLORS[0].hex;
    let isPrivate = false;
    popup.innerHTML = `
      <div class="quote">${this.escapeHtml(quoteText)}</div>
      <textarea placeholder="Add your thoughts..." maxlength="5000" autofocus></textarea>
      <div class="row"><span class="label">Color</span>${HIGHLIGHT_COLORS.slice(0, 6).map((color, index) =>
        `<button type="button" class="swatch${index === 0 ? ' active' : ''}" data-color="${color.hex}" style="background:${color.hex}" title="${color.name}"></button>`).join('')}
        <button type="button" class="privacy">🌐 Public</button>
      </div>
      <div class="actions"><button type="button" class="action cancel">Cancel</button><button type="button" class="action save">Save</button></div>
    `;
    const textarea = popup.querySelector('textarea') as HTMLTextAreaElement;
    popup.querySelectorAll<HTMLButtonElement>('.swatch').forEach((button) => button.addEventListener('click', () => {
      popup.querySelector('.swatch.active')?.classList.remove('active');
      button.classList.add('active');
      selectedColor = button.dataset.color || selectedColor;
    }));
    const privacy = popup.querySelector('.privacy') as HTMLButtonElement;
    privacy.addEventListener('click', () => {
      isPrivate = !isPrivate;
      privacy.textContent = isPrivate ? '🔒 Private' : '🌐 Public';
    });
    const cancel = () => { this.hide(); this.callbacks.onCancel(); };
    popup.querySelector('.cancel')?.addEventListener('click', cancel);
    popup.querySelector('.save')?.addEventListener('click', () => {
      const save = popup.querySelector('.save') as HTMLButtonElement;
      save.disabled = true;
      this.hide();
      this.callbacks.onSave({
        url: url || canonicalAnnotationUrl(window.location.href),
        quoteText,
        text: textarea.value,
        selectors,
        isPrivate,
        type: 'text',
        highlightColor: selectedColor,
        linkPreviewImageMode: 'default',
      });
    });
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); cancel(); }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault(); (popup.querySelector('.save') as HTMLButtonElement).click();
      }
    });
    shadow.appendChild(popup);
    this.mount(rect, popup);
    setTimeout(() => textarea.focus(), 0);
  }

  hide(): void {
    this.host?.remove();
    this.host = null;
  }

  private mount(rect: DOMRect, popup: HTMLElement): void {
    document.body.appendChild(this.host!);
    const width = 320;
    const left = Math.max(8, Math.min(rect.left + window.scrollX + rect.width / 2 - width / 2,
      window.innerWidth - width - 8 + window.scrollX));
    this.host!.style.left = `${left}px`;
    this.host!.style.top = '-10000px';
    const height = popup.offsetHeight;
    this.host!.style.top = rect.top < height + 16
      ? `${rect.bottom + window.scrollY + 8}px`
      : `${rect.top + window.scrollY - height - 8}px`;
  }

  private escapeHtml(value: string): string {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
  }
}
