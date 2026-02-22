/**
 * Message type constants for communication between background and content scripts.
 */
export const MSG = {
    PING: 'PING',
    GET_CONTENT: 'GET_CONTENT',
    SHOW_MODAL: 'SHOW_MODAL',
    SET_STATUS: 'SET_STATUS',
    UPDATE_CONTENT: 'UPDATE_CONTENT',
};

/**
 * Port name for keepalive connection during long-running operations.
 */
export const KEEPALIVE_PORT = 'sanitize-keepalive';

/**
 * ID for the modal root element in the DOM.
 */
export const MODAL_ROOT_ID = 'llm-sanitizer-modal-root';
