package com.malmohlady.theforge;

import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

/* Unified Forge shell (U0).
   The only native tweak: allow programmatic media playback without a
   per-call user gesture. Coach cues are timer-driven; Android WebView's
   default gesture policy silently rejects them (M1 finding F2). The web
   layer additionally routes every cue through one gesture-unlocked player
   (unified/audio-core.js) — this setting is the second layer, not the fix
   on its own. */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        }
    }
}
