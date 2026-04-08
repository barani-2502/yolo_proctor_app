/*! coi-serviceworker v0.1.7 | MIT License | https://github.com/gzuidhof/coi-serviceworker */
if (typeof window === 'undefined') {
    self.addEventListener("install", () => self.skipWaiting());
    self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

    self.addEventListener("fetch", (event) => {
        if (event.request.cache === "only-if-cached" && event.request.mode !== "same-origin") {
            return;
        }

        event.respondWith(
            fetch(event.request).then((response) => {
                if (response.status === 0) {
                    return response;
                }

                const newHeaders = new Headers(response.headers);
                newHeaders.set("Cross-Origin-Embedder-Policy", "require-corp");
                newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

                return new Response(response.body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: newHeaders,
                });
            })
        );
    });
} else {
    const script = document.currentScript;
    script.parentNode.removeChild(script);

    const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if ('serviceWorker' in navigator && !isDev) {
        window.addEventListener("load", () => {
            const swPath = script.src; // Get absolute path of this script
            navigator.serviceWorker.register(swPath)
                .then(registration => {
                    registration.addEventListener("updatefound", () => {
                        if (navigator.serviceWorker.controller) {
                            console.log("Reloading for updated service worker...");
                            window.location.reload();
                        }
                    });

                    if (registration.active && !navigator.serviceWorker.controller) {
                        window.location.reload();
                    }
                });
        });
    }
}
