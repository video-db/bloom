export async function initOnboarding() {
    const modal = document.getElementById('onboardingModal');
    const nameInput = document.getElementById('nameInput');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const toggleApiKeyBtn = document.getElementById('toggleApiKey');
    const connectBtn = document.getElementById('connectBtn');
    const errorMsg = document.getElementById('onboardingError');
    const getApiKeyLink = document.getElementById('getApiKeyLink');

    // Load current settings
    const currentSettings = await window.configAPI.getConfig();

    // Check if we need to show onboarding
    if (!currentSettings.accessToken) {
        modal.classList.add('visible');
    } else {
        return true;
    }

    // External link for API key
    if (getApiKeyLink) {
        getApiKeyLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.configAPI.openExternalLink('https://console.videodb.io/dashboard');
        });
    }

    // Toggle API key visibility
    toggleApiKeyBtn.addEventListener('click', () => {
        const type = apiKeyInput.getAttribute('type') === 'password' ? 'text' : 'password';
        apiKeyInput.setAttribute('type', type);
        const icon = toggleApiKeyBtn.querySelector('.material-icons');
        if (icon) icon.textContent = type === 'password' ? 'visibility' : 'visibility_off';
    });

    // Connect button
    connectBtn.addEventListener('click', async () => {
        const name = nameInput.value.trim();
        const apiKey = apiKeyInput.value.trim();

        if (!name) {
            errorMsg.textContent = 'Please enter your name.';
            return;
        }
        if (!apiKey) {
            errorMsg.textContent = 'Please enter a valid API Key.';
            return;
        }

        connectBtn.textContent = 'Connecting...';
        connectBtn.disabled = true;
        errorMsg.textContent = '';

        try {
            const result = await window.configAPI.register({
                name,
                apiKey
            });

            if (result.success) {
                modal.classList.remove('visible');
                // Update user name header
                const tooltip = document.getElementById('userNameTooltip');
                const menuName = document.getElementById('menuUserName');
                if (result.userName) {
                    if (tooltip) tooltip.textContent = result.userName;
                    if (menuName) menuName.textContent = result.userName;
                }
            } else {
                errorMsg.textContent = result.error || 'Failed to connect.';
                connectBtn.disabled = false;
                connectBtn.textContent = 'Connect';
            }
        } catch (err) {
            console.error(err);
            errorMsg.textContent = 'An unexpected error occurred.';
            connectBtn.disabled = false;
            connectBtn.textContent = 'Connect';
        }
    });
}
