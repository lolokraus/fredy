/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { fixMapboxDrawCompatibility, addDrawingControl, setupAreaFilterEventListeners } from './MapDrawingExtension.js';
import { getBoundsFromCoords } from '../../views/listings/mapUtils.js';
import './Map.less';

export const DEFAULT_COUNTRY = 'de';

// Per-country view config, keyed by metaInformation.country ([SW, NE] in [lng, lat]).
// fitBounds() targets `fitBounds` (the country extent) so the whole country is framed
// at any size; `maxBounds` must be a generous superset, else MapLibre over-zooms to
// satisfy it and clips the view. `center`/`zoom` are only the pre-fit seed.
export const COUNTRY_VIEWS = {
  de: {
    center: [10.4515, 51.1657],
    zoom: 4,
    fitBounds: [
      [5.866, 47.27],
      [15.042, 55.059],
    ],
    maxBounds: [
      [3.0, 45.0],
      [18.5, 56.5],
    ],
  },
  at: {
    center: [14.1, 47.6],
    zoom: 6,
    fitBounds: [
      [9.4, 46.3],
      [17.3, 49.1],
    ],
    maxBounds: [
      [7.0, 44.5],
      [19.5, 50.5],
    ],
  },
};

export const getCountryView = (country) => COUNTRY_VIEWS[country] ?? COUNTRY_VIEWS[DEFAULT_COUNTRY];

export const STYLES = {
  STANDARD: 'https://tiles.openfreemap.org/styles/bright',
  SATELLITE: {
    version: 8,
    sources: {
      'satellite-tiles': {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution:
          'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
      },
      'satellite-labels': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        attribution: '© Esri',
      },
    },
    layers: [
      {
        id: 'satellite-tiles',
        type: 'raster',
        source: 'satellite-tiles',
        minzoom: 0,
        maxzoom: 19,
      },
      {
        id: 'satellite-labels',
        type: 'raster',
        source: 'satellite-labels',
        minzoom: 0,
        maxzoom: 19,
      },
    ],
  },
};

export default function Map({
  style = 'STANDARD',
  show3dBuildings = false,
  onMapReady = null,
  enableDrawing = false,
  initialSpatialFilter = null,
  onDrawingChange = null,
  country = DEFAULT_COUNTRY,
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const drawRef = useRef(null);
  const hasFittedToInitialAreaRef = useRef(false);

  // Initialize map - ONLY when container changes, never reinitialize
  useEffect(() => {
    if (mapRef.current) return; // Map already exists, don't reinitialize

    const initialView = getCountryView(country);
    mapRef.current = new maplibregl.Map({
      container: mapContainerRef.current,
      style: STYLES[style],
      center: initialView.center,
      zoom: initialView.zoom,
      maxBounds: initialView.maxBounds,
      antialias: true,
    });

    mapRef.current.addControl(
      new maplibregl.NavigationControl({
        showCompass: true,
        visualizePitch: true,
        visualizeRoll: true,
      }),
      'top-right',
    );

    mapRef.current.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: {
          enableHighAccuracy: true,
        },
        trackUserLocation: true,
      }),
    );

    // Initialize drawing extension only if enabled
    if (enableDrawing) {
      fixMapboxDrawCompatibility();
      drawRef.current = addDrawingControl(mapRef.current);
    }

    // Call onMapReady callback if provided
    if (onMapReady) {
      onMapReady(mapRef.current);
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [mapContainerRef]); // ONLY depend on mapContainerRef - nothing else!

  // Load spatial filter and setup area filter event listeners
  useEffect(() => {
    if (!mapRef.current || !drawRef.current || !enableDrawing) return;

    // Load initial spatial filter if provided
    if (initialSpatialFilter) {
      try {
        drawRef.current.set(initialSpatialFilter);
      } catch (error) {
        console.error('Error loading spatial filter:', error);
      }

      if (!hasFittedToInitialAreaRef.current) {
        const coords = initialSpatialFilter.features.flatMap((feature) =>
          feature.geometry?.type === 'Polygon' ? feature.geometry.coordinates.flat() : [],
        );
        const bounds = getBoundsFromCoords(coords);
        if (bounds) {
          mapRef.current.fitBounds(bounds, { padding: 50, maxZoom: 15, duration: 0 });
          hasFittedToInitialAreaRef.current = true;
        }
      }
    }

    // Setup drawing event listeners
    const cleanup = setupAreaFilterEventListeners(mapRef.current, drawRef.current, onDrawingChange);

    return cleanup;
  }, [initialSpatialFilter, onDrawingChange, enableDrawing]);

  // Handle style changes
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setStyle(STYLES[style]);
    }
  }, [style]);

  // Re-frame / re-constrain the map when the country changes. maxBounds is widened
  // first so the fitBounds isn't clamped; re-framing is skipped when an area is
  // already drawn, to avoid pulling the user off their filter.
  useEffect(() => {
    if (!mapRef.current) return;
    const view = getCountryView(country);
    mapRef.current.setMaxBounds(null);
    mapRef.current.setMaxBounds(view.maxBounds);
    if (!initialSpatialFilter) {
      mapRef.current.fitBounds(view.fitBounds, { padding: 20, duration: 0 });
    }
  }, [country]);

  // Handle 3D buildings layer
  useEffect(() => {
    if (!mapRef.current) return;

    const add3dLayer = () => {
      if (!mapRef.current || !mapRef.current.isStyleLoaded()) return;
      if (show3dBuildings) {
        if (!mapRef.current.getSource('openfreemap')) {
          mapRef.current.addSource('openfreemap', {
            type: 'vector',
            url: 'https://tiles.openfreemap.org/planet',
          });
        }
        if (!mapRef.current.getLayer('3d-buildings')) {
          const layers = mapRef.current.getStyle().layers;
          let labelLayerId;
          for (let i = 0; i < layers.length; i++) {
            if (layers[i].type === 'symbol' && layers[i].layout?.['text-field']) {
              labelLayerId = layers[i].id;
              break;
            }
          }
          mapRef.current.addLayer(
            {
              id: '3d-buildings',
              source: 'openfreemap',
              'source-layer': 'building',
              type: 'fill-extrusion',
              minzoom: 15,
              filter: ['!=', ['get', 'hide_3d'], true],
              paint: {
                'fill-extrusion-color': [
                  'interpolate',
                  ['linear'],
                  ['get', 'render_height'],
                  0,
                  'lightgray',
                  200,
                  'royalblue',
                  400,
                  'lightblue',
                ],
                'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, ['get', 'render_height']],
                'fill-extrusion-base': ['case', ['>=', ['get', 'zoom'], 16], ['get', 'render_min_height'], 0],
                'fill-extrusion-opacity': 0.6,
              },
            },
            labelLayerId,
          );
        }
      } else {
        if (mapRef.current.getLayer('3d-buildings')) {
          mapRef.current.removeLayer('3d-buildings');
        }
      }
    };

    add3dLayer();
  }, [show3dBuildings, style]);

  // Handle pitch for 3D
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setPitch(show3dBuildings ? 45 : 0);
  }, [show3dBuildings]);

  return <div ref={mapContainerRef} className="map-container" />;
}
