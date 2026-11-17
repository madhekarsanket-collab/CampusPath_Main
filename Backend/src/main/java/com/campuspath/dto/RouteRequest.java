package com.campuspath.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public class RouteRequest {

    private Point start;
    private Point end;
    private String startNode;
    private String endNode;
    private Boolean rain;
    private String time;
    private Boolean avoidCrowds;

    public RouteRequest() {}

    public Boolean getAvoidCrowds() { return avoidCrowds; }
    public void setAvoidCrowds(Boolean avoidCrowds) { this.avoidCrowds = avoidCrowds; }

    public RouteRequest(Point start, Point end) {
        this.start = start;
        this.end = end;
    }

    public Point getStart() {
        return start;
    }

    public void setStart(Point start) {
        this.start = start;
    }

    public Point getEnd() {
        return end;
    }

    public void setEnd(Point end) {
        this.end = end;
    }

    public String getStartNode() {
        return startNode;
    }

    public void setStartNode(String startNode) {
        this.startNode = startNode;
    }

    public String getEndNode() {
        return endNode;
    }

    public void setEndNode(String endNode) {
        this.endNode = endNode;
    }

    public Boolean getRain() {
        return rain;
    }

    public void setRain(Boolean rain) {
        this.rain = rain;
    }

    public String getTime() {
        return time;
    }

    public void setTime(String time) {
        this.time = time;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Point {
        private Double lng;
        private Double lat;

        public Point() {}

        public Point(Double lng, Double lat) {
            this.lng = lng;
            this.lat = lat;
        }

        public Double getLng() {
            return lng;
        }

        public void setLng(Double lng) {
            this.lng = lng;
        }

        public Double getLat() {
            return lat;
        }

        public void setLat(Double lat) {
            this.lat = lat;
        }
    }
}
