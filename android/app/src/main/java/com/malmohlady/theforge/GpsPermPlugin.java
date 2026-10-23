package com.malmohlady.theforge;

import android.Manifest;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/* U2 spike: the smallest possible native bridge for the Android runtime
   location permission, so the web layer can ask for and report the
   permission state (first grant / denial / recovery / revocation).
   No dependency — one plugin class on the Capacitor base. The WebView's
   own geolocation prompt grant is Capacitor's BridgeWebChromeClient. */
@CapacitorPlugin(name = "GpsPerm", permissions = {
    @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION })
})
public class GpsPermPlugin extends Plugin {

    @PluginMethod
    public void state(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("state", getPermissionState("location").name().toLowerCase());
        call.resolve(ret);
    }

    @PluginMethod
    public void request(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("state", "granted");
            call.resolve(ret);
        } else {
            requestPermissionForAlias("location", call, "permCallback");
        }
    }

    @PermissionCallback
    private void permCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("state", getPermissionState("location").name().toLowerCase());
        call.resolve(ret);
    }
}
