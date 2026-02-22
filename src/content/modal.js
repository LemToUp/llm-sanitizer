import modalCss from './modal.css?raw';
import { KEEPALIVE_PORT, MODAL_ROOT_ID } from '../shared/messages.js';
import { VERBOSITY_OPTIONS, DEFAULT_VERBOSITY, THEME_OPTIONS, DEFAULT_THEME } from '../shared/defaults.js';

/**
 * Modal UI for displaying sanitized content with streaming support.
 * Encapsulates all modal state and DOM management.
 */
export class Modal {
    constructor() {
        this.root = null;
        this.contentDiv = null;
        this.statusDiv = null;
        this.keepAlivePort = null;
        this.isFirstUpdate = true;
        this.isError = false;
        this._savedBodyOverflow = null;
    }

    /**
     * Show the modal with initial content.
     * 
     * @param {string} content - Initial content to display
     * @param {object} options - Modal options
     * @param {boolean} [options.isError=false] - Whether this is an error modal
     * @param {boolean} [options.keepAlive=false] - Whether to establish keepalive connection
     */
    show(content, { isError = false, keepAlive = false } = {}) {
        // Reset state
        this.isFirstUpdate = true;
        this.isError = isError;

        // Disconnect existing port if any
        if (this.keepAlivePort) {
            try { this.keepAlivePort.disconnect(); } catch (_) {}
            this.keepAlivePort = null;
        }

        // Remove existing modal if any
        const existing = document.getElementById(MODAL_ROOT_ID);
        if (existing) existing.remove();

        // Create root element with shadow DOM
        this.root = document.createElement('div');
        this.root.id = MODAL_ROOT_ID;
        const shadow = this.root.attachShadow({ mode: 'open' });

        // Inject styles
        const style = document.createElement('style');
        style.textContent = modalCss;

        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'overlay';

        // Create modal
        const modal = document.createElement('div');
        modal.className = isError ? 'modal error' : 'modal';
        modal.tabIndex = -1; // Make focusable

        // ── Header (sticky) ──
        const header = document.createElement('div');
        header.className = 'header';

        const headerLeft = document.createElement('div');
        headerLeft.className = 'header-left';

        // Settings expansion toggle
        const settingsToggle = document.createElement('button');
        settingsToggle.className = 'settings-toggle';
        settingsToggle.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
            Settings
        `;
        headerLeft.appendChild(settingsToggle);
        header.appendChild(headerLeft);

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'close-btn';
        closeBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        `;
        closeBtn.onclick = () => this.close();
        header.appendChild(closeBtn);

        // ── Settings panel (collapsible) ──
        const settingsPanel = document.createElement('div');
        settingsPanel.className = 'settings-panel';

        // Theme row
        const themeRow = document.createElement('div');
        themeRow.className = 'settings-row';

        const themeLabel = document.createElement('span');
        themeLabel.className = 'settings-label';
        themeLabel.textContent = 'Theme:';
        themeRow.appendChild(themeLabel);

        const themeGroup = this._createThemeGroup(modal);
        themeRow.appendChild(themeGroup);
        settingsPanel.appendChild(themeRow);

        // Verbosity row
        const verbosityRow = document.createElement('div');
        verbosityRow.className = 'settings-row';

        const verbosityLabel = document.createElement('span');
        verbosityLabel.className = 'settings-label';
        verbosityLabel.textContent = 'Detail:';
        verbosityRow.appendChild(verbosityLabel);

        const verbosityGroup = this._createVerbosityGroup();
        verbosityRow.appendChild(verbosityGroup);
        settingsPanel.appendChild(verbosityRow);

        // Toggle expansion
        settingsToggle.onclick = () => {
            settingsToggle.classList.toggle('open');
            settingsPanel.classList.toggle('open');
        };

        // Establish keepalive connection if requested
        if (keepAlive) {
            this.keepAlivePort = chrome.runtime.connect({ name: KEEPALIVE_PORT });
            this.keepAlivePort.onDisconnect.addListener(() => { this.keepAlivePort = null; });
        }

        // ── Scrollable body ──
        const modalBody = document.createElement('div');
        modalBody.className = 'modal-body';

        // Status indicator
        const statusDiv = document.createElement('div');
        statusDiv.className = 'status';
        statusDiv.innerHTML = `
            <span class="status-label">Preparing...</span>
            <div class="status-bar"><div class="status-bar-fill indeterminate"></div></div>
        `;
        this.statusDiv = statusDiv;

        // Content container
        const contentDiv = document.createElement('div');
        contentDiv.className = 'content';

        if (isError) {
            statusDiv.style.display = 'none';
            const errorHeader = document.createElement('div');
            errorHeader.className = 'error-icon';
            errorHeader.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                Something went wrong
            `;
            contentDiv.appendChild(errorHeader);
        }

        // Add initial content
        content.split('\n').forEach(line => {
            if (line.trim()) {
                const p = document.createElement('p');
                p.textContent = line;
                contentDiv.appendChild(p);
            }
        });

        this.contentDiv = contentDiv;

        // Assemble modal
        modalBody.appendChild(statusDiv);
        modalBody.appendChild(contentDiv);
        modal.appendChild(header);
        modal.appendChild(settingsPanel);
        modal.appendChild(modalBody);
        overlay.appendChild(modal);
        shadow.appendChild(style);
        shadow.appendChild(overlay);

        // Close on overlay click
        overlay.onclick = (e) => {
            if (e.target === overlay) this.close();
        };

        // Close on Escape key
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.close();
        });

        // Prevent scroll from leaking to the host page
        overlay.addEventListener('wheel', (e) => {
            const path = e.composedPath();
            if (!path.includes(modalBody)) {
                e.preventDefault();
                return;
            }
            // At scroll boundaries — block to prevent chaining
            const { scrollTop, scrollHeight, clientHeight } = modalBody;
            const atTop = scrollTop <= 0 && e.deltaY < 0;
            const atBottom = scrollTop + clientHeight >= scrollHeight && e.deltaY > 0;
            if (atTop || atBottom) {
                e.preventDefault();
            }
        }, { passive: false });

        // Lock host page scroll
        this._savedBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        // Add to document
        document.body.appendChild(this.root);

        // Set focus
        setTimeout(() => modal.focus(), 50);
    }

    /**
     * Update the status indicator.
     * 
     * @param {string} text - Status text to display
     * @param {number|null} progress - Progress value (0-1) or null for indeterminate
     */
    setStatus(text, progress) {
        if (!this.statusDiv) return;

        this.statusDiv.style.display = '';
        const label = this.statusDiv.querySelector('.status-label');
        const bar = this.statusDiv.querySelector('.status-bar-fill');

        if (label) label.textContent = text;
        if (bar) {
            if (typeof progress === 'number') {
                bar.style.width = `${Math.round(progress * 100)}%`;
                bar.classList.remove('indeterminate');
            } else {
                // Indeterminate — animate
                bar.style.width = '';
                bar.classList.add('indeterminate');
            }
        }
    }

    /**
     * Update modal content with streaming delta.
     * 
     * @param {string} delta - Text chunk to append
     */
    updateContent(delta) {
        if (!this.contentDiv || this.isError) return;

        if (this.isFirstUpdate) {
            this.contentDiv.innerHTML = ''; // Clear initial text
            this.isFirstUpdate = false;
        }

        // Hide status indicator whenever content is streaming
        if (this.statusDiv) this.statusDiv.style.display = 'none';

        // Handle newlines by creating paragraphs
        const lines = delta.split('\n');

        if (lines.length === 1) {
            // Append to last paragraph or create one
            let lastP = this.contentDiv.lastElementChild;
            if (!lastP || lastP.tagName !== 'P') {
                lastP = document.createElement('p');
                this.contentDiv.appendChild(lastP);
            }
            lastP.textContent += lines[0];
        } else {
            // Handle multiple lines
            lines.forEach((line, i) => {
                if (i === 0) {
                    // Append to last P
                    let lastP = this.contentDiv.lastElementChild;
                    if (!lastP || lastP.tagName !== 'P') {
                        lastP = document.createElement('p');
                        this.contentDiv.appendChild(lastP);
                    }
                    lastP.textContent += line;
                } else {
                    // New P
                    const p = document.createElement('p');
                    p.textContent = line;
                    this.contentDiv.appendChild(p);
                }
            });
        }

        // Auto-scroll only if the user hasn't scrolled up to read
        const modalBody = this.contentDiv.closest('.modal-body');
        if (modalBody) {
            const distanceFromBottom = modalBody.scrollHeight - modalBody.scrollTop - modalBody.clientHeight;
            if (distanceFromBottom < 50) {
                modalBody.scrollTop = modalBody.scrollHeight;
            }
        }
    }

    /**
     * Create the theme toggle button group.
     * Reads the current value from storage and saves on change.
     * 
     * @param {HTMLElement} modal - The modal element to apply data-theme to
     * @returns {HTMLElement}
     */
    _createThemeGroup(modal) {
        const group = document.createElement('div');
        group.className = 'toggle-group';

        const buttons = THEME_OPTIONS.map(({ id, label, icon }) => {
            const btn = document.createElement('button');
            btn.className = 'toggle-btn';
            btn.textContent = `${icon} ${label}`;
            btn.dataset.theme = id;

            btn.onclick = () => {
                buttons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                modal.dataset.theme = id;
                chrome.storage.local.set({ theme: id });
            };

            group.appendChild(btn);
            return btn;
        });

        // Load current value from storage and apply
        chrome.storage.local.get(['theme']).then(({ theme }) => {
            const current = theme || DEFAULT_THEME;
            modal.dataset.theme = current;
            const active = buttons.find(b => b.dataset.theme === current);
            if (active) active.classList.add('active');
        });

        return group;
    }

    /**
     * Create the verbosity toggle button group.
     * Reads the current value from storage and saves on change.
     * 
     * @returns {HTMLElement}
     */
    _createVerbosityGroup() {
        const group = document.createElement('div');
        group.className = 'toggle-group';

        const buttons = VERBOSITY_OPTIONS.map(({ id, label }) => {
            const btn = document.createElement('button');
            btn.className = 'toggle-btn';
            btn.textContent = label;
            btn.dataset.verbosity = id;

            btn.onclick = () => {
                buttons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                chrome.storage.local.set({ verbosity: id });
            };

            group.appendChild(btn);
            return btn;
        });

        // Load current value from storage and set active
        chrome.storage.local.get(['verbosity']).then(({ verbosity }) => {
            const current = verbosity || DEFAULT_VERBOSITY;
            const active = buttons.find(b => b.dataset.verbosity === current);
            if (active) active.classList.add('active');
        });

        return group;
    }

    /**
     * Close the modal and clean up resources.
     */
    close() {
        if (this.keepAlivePort) {
            try { this.keepAlivePort.disconnect(); } catch (_) {}
            this.keepAlivePort = null;
        }
        // Restore host page scroll
        if (this._savedBodyOverflow !== null) {
            document.body.style.overflow = this._savedBodyOverflow;
            this._savedBodyOverflow = null;
        }
        if (this.root) {
            this.root.remove();
            this.root = null;
        }
        this.contentDiv = null;
        this.statusDiv = null;
    }
}
