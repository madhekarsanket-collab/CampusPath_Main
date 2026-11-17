package com.campuspath;

import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

public class TestRunner {
    public static void main(String[] args) {
        System.setProperty("server.port", "0");
        ConfigurableApplicationContext context = SpringApplication.run(CampusPathApplication.class, args);
        try {
            WebApplicationContext webContext = (WebApplicationContext) context;
            MockMvc mockMvc = MockMvcBuilders.webAppContextSetup(webContext).build();

            System.out.println("Running Test 1: GET /api/route...");
            mockMvc.perform(get("/api/route")
                            .param("start", "MainGate")
                            .param("end", "AIML"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.type").value("Feature"))
                    .andExpect(jsonPath("$.geometry.type").value("LineString"))
                    .andExpect(jsonPath("$.geometry.coordinates").isArray());
            System.out.println("PASS: Test 1");

            System.out.println("Running Test 2: POST /api/route with coordinates...");
            String jsonCoords = """
                    {
                      "start": {"lng": 73.86730, "lat": 18.46363},
                      "end": {"lng": 73.86777, "lat": 18.46349}
                    }
                    """;
            mockMvc.perform(post("/api/route")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(jsonCoords))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.type").value("Feature"))
                    .andExpect(jsonPath("$.geometry.type").value("LineString"))
                    .andExpect(jsonPath("$.properties.distanceMeters").exists())
                    .andExpect(jsonPath("$.geometry.coordinates").isArray());
            System.out.println("PASS: Test 2");

            System.out.println("Running Test 3: POST /api/route with named nodes...");
            String jsonNamed = """
                    {
                      "startNode": "MainGate",
                      "endNode": "AIML"
                    }
                    """;
            mockMvc.perform(post("/api/route")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(jsonNamed))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.type").value("Feature"))
                    .andExpect(jsonPath("$.geometry.type").value("LineString"));
            System.out.println("PASS: Test 3");

            System.out.println("Running Test 4: POST /api/route missing parameters...");
            mockMvc.perform(post("/api/route")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error").exists());
            System.out.println("PASS: Test 4");

            System.out.println("Running Test 5: POST /api/route invalid coordinate range...");
            String jsonInvalid = """
                    {
                      "start": {"lng": 999.0, "lat": 18.46363},
                      "end": {"lng": 73.86777, "lat": 18.46349}
                    }
                    """;
            mockMvc.perform(post("/api/route")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(jsonInvalid))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error").exists());
            System.out.println("PASS: Test 5");

            System.out.println("\nALL 5 ROUTING TESTS PASSED SUCCESSFULLY!");
        } catch (Throwable t) {
            System.err.println("TEST FAILURE: " + t.getMessage());
            t.printStackTrace();
            System.exit(1);
        } finally {
            context.close();
        }
    }
}
