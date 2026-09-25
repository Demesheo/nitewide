import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cameraError } from '@/lib/admissions';

export function AdmissionCamera({ onScan, onError, onPause }) {
  const video = useRef(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false, stream, controls, detected = false, startupTimer;
    const stop = () => { clearTimeout(startupTimer); controls?.stop(); stream?.getTracks().forEach((track) => track.stop()); };
    const pause = () => { cancelled = true; stop(); onPause(); };
    const visibility = () => { if (document.hidden) pause(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pause);
    async function start() {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          onError('Camera scanning needs HTTPS. Use the secure hosted app on your iPhone, or check in manually.');
          return;
        }
        // Use the iPhone's rear camera without microphone access. Decode in the
        // browser; camera frames are never uploaded to the server.
        startupTimer = setTimeout(() => {
          cancelled = true;
          stop();
          onError('The camera did not start. Check camera permission, then try again, scan a photo, or use manual check-in.');
        }, 20000);
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
        if (cancelled) { stop(); return; }
        const { BrowserQRCodeReader } = await import('@zxing/browser');
        if (cancelled) { stop(); return; }
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150, delayBetweenScanSuccess: 1000 });
        controls = await reader.decodeFromStream(stream, video.current, (result, _error, scanner) => {
          if (!result || cancelled || detected) return;
          detected = true;
          scanner.stop(); stop();
          onScan(result.getText());
        });
        if (cancelled || detected) stop(); else { clearTimeout(startupTimer); setReady(true); }
      } catch (error) {
        stop();
        if (!cancelled) onError(cameraError(error));
      }
    }
    start();
    return () => { cancelled = true; stop(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', pause); };
  }, [onScan, onError, onPause]);
  return <div className="admission-camera"><video ref={video} muted playsInline autoPlay aria-label="Admission QR scanner camera preview" /><div className="admission-viewfinder" aria-hidden="true" />{!ready && <span className="admission-camera-loading" role="status"><LoaderCircle className="nw-loading-icon" /> Opening camera…</span>}<span className="admission-camera-hint">Hold the QR code inside the frame</span></div>;
}
