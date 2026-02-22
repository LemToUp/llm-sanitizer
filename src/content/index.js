import { MSG } from '../shared/messages.js';
import { extractContent } from './extractor.js';
import { Modal } from './modal.js';

/**
 * Content script message router.
 * Handles communication with the background script and manages modal UI.
 */

let modal = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
        case MSG.PING:
            sendResponse({ alive: true });
            break;

        case MSG.GET_CONTENT:
            try {
                const article = extractContent();
                sendResponse(article);
            } catch (err) {
                sendResponse({ error: err.message });
            }
            break;

        case MSG.SHOW_MODAL:
            modal = new Modal();
            modal.show(request.payload.content, {
                isError: request.payload.isError,
                keepAlive: request.payload.keepAlive,
            });
            sendResponse({ success: true });
            break;

        case MSG.SET_STATUS:
            if (modal) {
                modal.setStatus(request.payload.text, request.payload.progress);
            }
            sendResponse({ success: true });
            break;

        case MSG.UPDATE_CONTENT:
            if (modal) {
                modal.updateContent(request.payload.delta);
            }
            sendResponse({ success: true });
            break;

        default:
            sendResponse({ error: 'Unknown message type' });
    }
});

