import React, { useMemo, useRef } from "react";
import { StyleSheet, View, Platform } from "react-native";
import { WebView } from "react-native-webview";

type Marker = {
  id: string;
  lat: number;
  lon: number;
  label?: string;
  color?: string;
  badge?: string | number;
};

type Props = {
  center: { latitude: number; longitude: number };
  zoom?: number;
  markers?: Marker[];
  polygon?: { latitude: number; longitude: number }[];
  polyline?: number[][]; // [[lat,lon], ...]
  onMarkerPress?: (id: string) => void;
};

function buildHtml(
  center: { latitude: number; longitude: number },
  zoom: number,
  markers: Marker[],
  polygon: { latitude: number; longitude: number }[],
  polyline: number[][]
) {
  const markersJson = JSON.stringify(markers || []);
  const polygonJson = JSON.stringify(
    (polygon || []).map((p) => [p.latitude, p.longitude])
  );
  const polylineJson = JSON.stringify(polyline || []);
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
  html, body, #map { margin:0; padding:0; height:100%; width:100%; background:#000; }
  .leaflet-container { background:#0a0a0a; }
  .pulse-marker {
    width:22px;height:22px;border-radius:50%;
    background:#FF5A00;border:3px solid #fff;
    box-shadow:0 0 0 4px rgba(255,90,0,0.35);
    display:flex;align-items:center;justify-content:center;
    color:#fff;font-weight:700;font-size:11px;font-family:system-ui;
  }
  .ztl-marker {
    width:22px;height:22px;border-radius:50%;
    background:#DC2626;border:3px solid #fff;
    box-shadow:0 0 0 4px rgba(220,38,38,0.35);
    display:flex;align-items:center;justify-content:center;
    color:#fff;font-weight:700;font-size:11px;font-family:system-ui;
  }
  .blue-marker {
    width:22px;height:22px;border-radius:50%;
    background:#3B82F6;border:3px solid #fff;
    box-shadow:0 0 0 4px rgba(59,130,246,0.35);
    display:flex;align-items:center;justify-content:center;
    color:#fff;font-weight:700;font-size:11px;font-family:system-ui;
  }
  .start-marker {
    width:18px;height:18px;border-radius:50%;
    background:#10B981;border:3px solid #fff;
    box-shadow:0 0 0 6px rgba(16,185,129,0.35);
  }
  .leaflet-popup-content-wrapper {
    background:#111;color:#fff;border-radius:8px;
  }
  .leaflet-popup-tip { background:#111; }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var map = L.map('map', { zoomControl: false, attributionControl: false })
    .setView([${center.latitude}, ${center.longitude}], ${zoom});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
  }).addTo(map);

  var poly = ${polygonJson};
  if (poly && poly.length > 2) {
    L.polygon(poly, {
      color: '#DC2626', weight: 2, fillColor: '#DC2626', fillOpacity: 0.18
    }).addTo(map).bindPopup('ZTL Centro Storico');
  }

  var markers = ${markersJson};
  markers.forEach(function(m) {
    var iconCls = m.color === 'red' ? 'ztl-marker' : (m.color === 'blue' ? 'blue-marker' : (m.color === 'green' ? 'start-marker' : 'pulse-marker'));
    var badge = (m.badge !== undefined && m.badge !== null) ? String(m.badge) : '';
    var icon = L.divIcon({ className: '', html: '<div class="'+iconCls+'">'+badge+'</div>', iconSize:[22,22], iconAnchor:[11,11]});
    var marker = L.marker([m.lat, m.lon], { icon: icon }).addTo(map);
    if (m.label) marker.bindPopup(m.label);
    marker.on('click', function() {
      try {
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'marker', id: m.id}));
      } catch(e) {}
    });
  });

  var line = ${polylineJson};
  if (line && line.length > 1) {
    var poly = L.polyline(line, { color: '#FF5A00', weight: 5, opacity: 0.9 }).addTo(map);
    try { map.fitBounds(poly.getBounds(), { padding: [40,40] }); } catch(e) {}
  }

  function recenter(lat, lng, z) { map.setView([lat,lng], z || map.getZoom()); }
  window.addEventListener('message', function(ev){
    try {
      var data = JSON.parse(ev.data);
      if (data && data.type === 'center') recenter(data.lat, data.lng, data.zoom);
    } catch(e) {}
  });
</script>
</body></html>`;
}

export default function MapView({ center, zoom = 14, markers = [], polygon = [], polyline = [], onMarkerPress }: Props) {
  const html = useMemo(
    () => buildHtml(center, zoom, markers, polygon, polyline),
    [center.latitude, center.longitude, zoom, markers, polygon, polyline]
  );
  const webRef = useRef<WebView>(null);

  // On web platform, we render via iframe srcDoc (WebView from react-native-web is limited)
  if (Platform.OS === "web") {
    return (
      <View style={styles.container} testID="osm-map">
        {/* @ts-ignore web only */}
        <iframe
          srcDoc={html}
          style={{ border: 0, width: "100%", height: "100%", backgroundColor: "#000" }}
          title="osm-map"
        />
      </View>
    );
  }

  return (
    <View style={styles.container} testID="osm-map">
      <WebView
        ref={webRef}
        originWhitelist={["*"]}
        source={{ html }}
        style={{ backgroundColor: "#000" }}
        javaScriptEnabled
        domStorageEnabled
        onMessage={(e) => {
          try {
            const d = JSON.parse(e.nativeEvent.data);
            if (d.type === "marker" && onMarkerPress) onMarkerPress(d.id);
          } catch {}
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
});
