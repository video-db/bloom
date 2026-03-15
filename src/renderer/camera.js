// Camera Bubble Logic
const videoElement = document.getElementById('preview');
let cameraStream = null;

async function initCamera() {
    if (cameraStream) return; // Already initialized

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error('[Camera] mediaDevices API not available');
        return;
    }

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 640 },
                aspectRatio: 1
            },
            audio: false
        });
        videoElement.srcObject = cameraStream;
    } catch (err) {
        console.error('[Camera] Failed to get camera:', err.name, err.message);
    }
}

// Initialize/Destroy camera based on visibility
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopCamera();
    } else {
        initCamera();
    }
});

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
        videoElement.srcObject = null;
    }
}

// Initial check
if (!document.hidden) {
    initCamera();
}
