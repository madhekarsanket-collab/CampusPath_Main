// ==========================================
// 1. Mapbox Initialization
// ==========================================
// TODO: Replace with your actual Mapbox access token
mapboxgl.accessToken = 'pk.eyJ1Ijoic2FuNDA0MGciLCJhIjoiY211bjFrY2l0MDV6bTJ6czl3Nzg5ZjU4cyJ9.XVEgOWjAR3DDXyhynLPBng';

// Initialize the map
const map = new mapboxgl.Map({
    container: 'map', // ID of the HTML element
    style: 'mapbox://styles/mapbox/streets-v12', 
    center: [73.8682, 18.4632], // Centered closer to the main buildings
    zoom: 17.5, // Zoomed in much tighter on the campus
    pitch: 65, // Pitch in degrees for 3D view
    bearing: -17.6 // Bearing in degrees
});
window.map = map; // Shared with the AIML GLB custom layer

// HELPER: Click anywhere to get exact coordinates!
map.on('click', (e) => {
    const coords = `${e.lngLat.lng.toFixed(5)}, ${e.lngLat.lat.toFixed(5)}`;
    console.log("Clicked Coordinates:", coords);
    // Also copy to clipboard to make it easy for the user
    navigator.clipboard.writeText(coords).then(() => {
        console.log("Copied to clipboard!");
    });
});

// ==========================================
// 2. Add 3D Buildings Layer
// ==========================================
map.on('load', () => {
    // Insert the layer beneath any symbol layer.
    const layers = map.getStyle().layers;
    let labelLayerId;
    for (const layer of layers) {
        if (layer.type === 'symbol' && layer.layout['text-field']) {
            labelLayerId = layer.id;
            break;
        }
    }

    // Add 3D building extrusions
    map.addLayer(
        {
            'id': '3d-buildings',
            'source': 'composite',
            'source-layer': 'building',
            'filter': ['==', 'extrude', 'true'],
            'type': 'fill-extrusion',
            'minzoom': 15,
            'paint': {
                'fill-extrusion-color': '#aaa',

                // use an 'interpolate' expression to add a smooth transition effect to the
                // buildings as the user zooms in
                'fill-extrusion-height': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    15,
                    0,
                    15.05,
                    ['get', 'height']
                ],
                'fill-extrusion-base': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    15,
                    0,
                    15.05,
                    ['get', 'min_height']
                ],
                'fill-extrusion-opacity': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    16,
                    0.8, // Opacity is 0.8 at zoom level 16 (further away)
                    19,
                    0.2  // Opacity becomes 0.2 at zoom level 19 (zoomed in close)
                ]
            }
        },
        labelLayerId
    );
});

// ==========================================
// 3. Handle Form Submission, UI Logic & Map Clicks
// ==========================================
const routingForm = document.getElementById('routing-form');
const endSelect = document.getElementById('end');
const startSelect = document.getElementById('start');
const roomNumberGroup = document.getElementById('room-number-group');

// List of buildings that have rooms
const buildingsWithRooms = ['CS_DESH', 'AI_AIDS_Mech', 'AIML'];

// Show/Hide Room Number field based on destination selection
endSelect.addEventListener('change', (e) => {
    if (buildingsWithRooms.includes(e.target.value)) {
        roomNumberGroup.style.display = 'flex'; // Show field
    } else {
        roomNumberGroup.style.display = 'none'; // Hide field
        document.getElementById('roomNumber').value = ''; // Clear it
    }
});

// Trigger change event initially to set correct state
endSelect.dispatchEvent(new Event('change'));

// Handle Map Clicks to set Custom Start/End
let clickStartMarker = null;
let clickEndMarker = null;
let customStartCoords = null;
let customEndCoords = null;

// Custom Cursors for dropping pins
const greenCursor = `url('data:image/svg+xml;utf8,<svg width="32" height="32" viewBox="0 0 24 24" fill="%2328a745" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>') 16 32, auto`;
const redCursor = `url('data:image/svg+xml;utf8,<svg width="32" height="32" viewBox="0 0 24 24" fill="%23dc3545" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>') 16 32, auto`;

map.on('mousemove', () => {
    if (!clickStartMarker) {
        map.getCanvas().style.cursor = greenCursor;
    } else if (!clickEndMarker) {
        map.getCanvas().style.cursor = redCursor;
    } else {
        map.getCanvas().style.cursor = ''; // default grab cursor
    }
});

map.on('click', (e) => {
    if (window.aimlPlacementMode) return; // reserved for model calibration
    // If both are already set, a third click resets them to start over
    if (clickStartMarker && clickEndMarker) {
        clickStartMarker.remove();
        clickEndMarker.remove();
        clickStartMarker = null;
        clickEndMarker = null;
        customStartCoords = null;
        customEndCoords = null;
        
        // Reset dropdowns to their first valid options
        startSelect.selectedIndex = 0;
        endSelect.selectedIndex = 0;
        endSelect.dispatchEvent(new Event('change')); 
        return;
    }

    if (!clickStartMarker) {
        // Drop Start Pin
        customStartCoords = e.lngLat;
        clickStartMarker = new mapboxgl.Marker({ color: "#28a745" }) // Green
            .setLngLat(customStartCoords)
            .setPopup(new mapboxgl.Popup({ offset: 25 }).setText("Start Point"))
            .addTo(map);
        
        startSelect.value = "CustomMapPoint";
    } else if (!clickEndMarker) {
        // Drop End Pin
        customEndCoords = e.lngLat;
        clickEndMarker = new mapboxgl.Marker({ color: "#dc3545" }) // Red
            .setLngLat(customEndCoords)
            .setPopup(new mapboxgl.Popup({ offset: 25 }).setText("End Point"))
            .addTo(map);

        endSelect.value = "CustomMapPoint";
        endSelect.dispatchEvent(new Event('change')); // Hide room number field for custom clicks
    }
});

routingForm.addEventListener('submit', async (e) => {
    e.preventDefault(); // Prevent page reload

    // Gather data from the UI
    const startLocation = startSelect.value;
    const endLocation = endSelect.value;
    const endLocationName = endSelect.options[endSelect.selectedIndex].text;
    const roomNumber = document.getElementById('roomNumber').value.trim();
    const isRainFree = document.getElementById('rainFree').checked;
    const rawTime = document.getElementById('time').value; // e.g., "13:00"
    const formattedTime = rawTime.replace(':', ''); // Convert to "1300" for the backend

    // Determine the parameters to send to the backend
    let startParam = startLocation;
    if (startLocation === "CustomMapPoint" && customStartCoords) {
        startParam = `${customStartCoords.lng},${customStartCoords.lat}`;
    }
    
    let endParam = endLocation;
    if (endLocation === "CustomMapPoint" && customEndCoords) {
        endParam = `${customEndCoords.lng},${customEndCoords.lat}`;
    }

    console.log(`Requesting path from ${startParam} to ${endParam} (Room: ${roomNumber}). RainFree: ${isRainFree}, Time: ${formattedTime}`);

    // Update the button text to show loading state
    const btn = document.getElementById('find-path-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span>Calculating...</span> <i class="fa-solid fa-spinner fa-spin"></i>';
    btn.disabled = true;

    try {
        // TODO: Ensure Pramit's Spring Boot server is running and accessible
        // Example URL: http://localhost:8080/api/route?start=73.86,18.46&end=Lib&rain=true&time=1300
        const apiUrl = `http://localhost:8080/api/route?start=${startParam}&end=${endParam}&rain=${isRainFree}&time=${formattedTime}`;

        // **Fetching the real response from Pramit's backend**
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const geojsonData = await response.json();

        // Simulate network delay for the cool loading animation
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Draw the path on the map
        drawPath(geojsonData); 
        
        // Reset Views
        document.getElementById('outdoor-step-view').style.display = 'block';
        document.getElementById('indoor-step-view').style.display = 'none';
        
        const btnArrived = document.getElementById('btn-arrived');
        const outdoorInstruction = document.getElementById('outdoor-instruction');

        // Logic for Indoor Navigation
        if (buildingsWithRooms.includes(endLocation) && roomNumber !== '') {
            outdoorInstruction.innerHTML = `<strong>Follow path to ${endLocationName}</strong>`;
            btnArrived.style.display = 'flex'; // Show the "I've Arrived" button
            
            // Extract Floor from Room Number (Assuming standard 4-digit room numbers e.g. 4301 -> 3rd floor)
            let floorText = "the correct floor";
            let roomString = String(roomNumber);
            if(roomString.length === 4) {
                let floorDigit = parseInt(roomString.substring(1, 2)); // e.g. '3' from '4301'
                if(floorDigit === 0) floorText = "Ground Floor";
                else if(floorDigit === 1) floorText = "1st Floor";
                else if(floorDigit === 2) floorText = "2nd Floor";
                else if(floorDigit === 3) floorText = "3rd Floor";
                else floorText = `${floorDigit}th Floor`;
            } else if (roomString.length === 3) {
                 let floorDigit = parseInt(roomString.substring(0, 1)); // e.g. '3' from '301'
                 if(floorDigit === 1) floorText = "1st Floor";
                 else if(floorDigit === 2) floorText = "2nd Floor";
                 else if(floorDigit === 3) floorText = "3rd Floor";
                 else floorText = `${floorDigit}th Floor`;
            }

            // Populate Indoor Details
            document.getElementById('indoor-room-title').innerText = `Room ${roomNumber}`;
            document.getElementById('indoor-instructions-list').innerHTML = `
                <li><i class="fa-solid fa-door-open"></i> Enter ${endLocationName} Main Lobby</li>
                <li><i class="fa-solid fa-stairs"></i> Proceed to the <strong>${floorText}</strong></li>
                <li><i class="fa-solid fa-person-walking-arrow-right"></i> Follow the corridor signs to <strong>Room ${roomNumber}</strong></li>
            `;

        } else {
            // No room number provided or it's a canteen
            outdoorInstruction.innerHTML = `<strong>Follow path to ${endLocationName}</strong>`;
            btnArrived.style.display = 'none'; // Hide the arrived button, just show "Close"
        }

        // Show the Navigation Card
        document.getElementById('route-details').classList.remove('hidden');

    } catch (error) {
        console.error("Error fetching route:", error);
        alert("Failed to connect to the backend. Make sure the Java server is running.");
    } finally {
        // Restore button state
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
});

// UI Flow Handlers for the Card
document.getElementById('btn-arrived').addEventListener('click', () => {
    // Switch to Indoor View
    document.getElementById('outdoor-step-view').style.display = 'none';
    document.getElementById('indoor-step-view').style.display = 'block';
});

document.getElementById('close-details').addEventListener('click', () => {
    document.getElementById('route-details').classList.add('hidden');
});

document.getElementById('finish-route').addEventListener('click', () => {
    document.getElementById('route-details').classList.add('hidden');
});

// ==========================================
// 4. Draw Path on Map
// ==========================================
function drawPath(geojsonData) {
    // If a route already exists, remove it first
    if (map.getSource('route')) {
        map.removeLayer('route-line');
        map.removeSource('route');
    }

    // Add the new route data as a source
    map.addSource('route', {
        'type': 'geojson',
        'data': geojsonData
    });

    // Add a layer to style and display the route
    map.addLayer({
        'id': 'route-line',
        'type': 'line',
        'source': 'route',
        'layout': {
            'line-join': 'round',
            'line-cap': 'round'
        },
        'paint': {
            'line-color': '#007bff', // Glowing blue color
            'line-width': 6,
            'line-opacity': 0.8
        }
    });

    // Animate map camera to fit the bounds of the route (Optional enhancement)
    const coordinates = geojsonData.geometry.coordinates;
    const bounds = new mapboxgl.LngLatBounds(
        coordinates[0],
        coordinates[0]
    );
    for (const coord of coordinates) {
        bounds.extend(coord);
    }
    map.fitBounds(bounds, {
        padding: 80,
        pitch: 60,
        bearing: -17.6,
        maxZoom: 18.5 // Prevent it from zooming out too far
    });
}
