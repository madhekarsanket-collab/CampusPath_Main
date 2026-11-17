package com.campuspath;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class CampusPathApplicationTests {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void contextLoads() {}

    @Test
    void testGetRouteSuccess() throws Exception {
        mockMvc.perform(get("/api/route")
                        .param("start", "MainGate")
                        .param("end", "AIML"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.type").value("Feature"))
                .andExpect(jsonPath("$.geometry.type").value("LineString"))
                .andExpect(jsonPath("$.geometry.coordinates").isArray());
    }

    @Test
    void testPostRouteWithCoordinatesSuccess() throws Exception {
        String jsonPayload = """
                {
                  "start": {"lng": 73.86730, "lat": 18.46363},
                  "end": {"lng": 73.86777, "lat": 18.46349}
                }
                """;

        mockMvc.perform(post("/api/route")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(jsonPayload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.type").value("Feature"))
                .andExpect(jsonPath("$.geometry.type").value("LineString"))
                .andExpect(jsonPath("$.properties.distanceMeters").exists())
                .andExpect(jsonPath("$.geometry.coordinates").isArray());
    }

    @Test
    void testPostRouteWithNamedNodesSuccess() throws Exception {
        String jsonPayload = """
                {
                  "startNode": "MainGate",
                  "endNode": "AIML"
                }
                """;

        mockMvc.perform(post("/api/route")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(jsonPayload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.type").value("Feature"))
                .andExpect(jsonPath("$.geometry.type").value("LineString"));
    }

    @Test
    void testPostRouteMissingParametersReturnsBadRequest() throws Exception {
        String jsonPayload = "{}";

        mockMvc.perform(post("/api/route")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(jsonPayload))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists());
    }

    @Test
    void testPostRouteInvalidCoordinatesReturnsBadRequest() throws Exception {
        String jsonPayload = """
                {
                  "start": {"lng": 999.0, "lat": 18.46363},
                  "end": {"lng": 73.86777, "lat": 18.46349}
                }
                """;

        mockMvc.perform(post("/api/route")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(jsonPayload))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists());
    }
}
