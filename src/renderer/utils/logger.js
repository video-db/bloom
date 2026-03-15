/**
 * Logger utility for the renderer process
 */

// Format timestamp
function getTimestamp() {
    return new Date().toLocaleTimeString();
}

/**
 * Add a log entry to the logs panel
 * @param {string} message - The message to log
 * @param {string} type - 'info', 'error', 'success', 'api'
 */
export function addLog(message, type = 'info') {
    // Always log to console regardless of DOM state
    console.log(`[${type.toUpperCase()}] ${message}`);

    const logsDiv = document.getElementById('logs');
    if (!logsDiv) return;

    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.innerHTML = `<span style="color:#666; font-size:10px;">[${getTimestamp()}]</span> ${message}`;
    logsDiv.appendChild(entry);

    // Auto-scroll
    logsDiv.parentElement.scrollTop = logsDiv.parentElement.scrollHeight;
}
