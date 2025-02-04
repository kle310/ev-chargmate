import express from "express";
import { Pool } from "pg";
import { config } from "dotenv";
import session from "express-session";
import { StationModel } from "./models/stationModel";
import { StationController } from "./controllers/stationController";
import { createStationRouter } from "./routes/stationRoutes";
import { createChatRouter } from "./routes/chatRoutes";
import { generateHomeView } from "./views/homeView";
import { generateChatbotView } from "./views/chatbotView";
import { generateMapView } from "./views/mapView";
import { generateDetailedView } from "./views/detailedView";
import { generateStatusPage } from "./views/liveView";
import path from "path";

config();

const port = process.env.PORT || 3000;

// Initialize database connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || "5432"),
});

const stationModel = new StationModel(pool);

// Initialize Express app
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: process.env.NODE_ENV === "production" },
  })
);

// Subdomain handling middleware
app.use((req, res, next) => {
  const host = req.get("host") || "";
  const subdomain = host.split(".")[0];

  // Map subdomains to regions (default to 'la' if no subdomain or unknown)
  const regionMap: { [key: string]: string } = {
    sf: "sf",
    la: "la",
    sd: "sd",
  };

  // Don't process if it's localhost without subdomain
  if (host === "localhost:3000") {
    req.region = regionMap["la"]; // Default to LA
    return next();
  }

  // Set region based on subdomain, default to LA
  req.region = regionMap[subdomain] || regionMap["la"];

  // Log for debugging
  console.log(`Host: ${host}, Subdomain: ${subdomain}, Region: ${req.region}`);

  next();
});

const stationController = new StationController(stationModel);
const stationRouter = createStationRouter(stationController);
const chatRouter = createChatRouter(stationModel);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, "public")));

app.use("/api", stationRouter);
app.use("/", chatRouter);

app.get("/", async (req, res) => {
  const stations = await stationModel.getAllStations(req.region);
  const selectedCity = (req.query.city as string) || "all";

  const groupedStations = {
    free: stations.filter((station) => Number(station.price) === 0),
    paid: stations.filter((station) => Number(station.price) > 0),
  };

  res.send(generateHomeView(groupedStations, selectedCity));
});

app.get("/map", async (req, res) => {
  try {
    const fastOnly = req.query.fastOnly === "true";
    const stations = await stationController.fetchStationsForMap(
      req.region,
      fastOnly
    );
    res.send(generateMapView(stations));
  } catch (error) {
    console.error("Error fetching stations for map:", error);
    res.status(500).send("Error loading map data");
  }
});

app.get("/chat", (req, res) => {
  res.send(generateChatbotView());
});

app.get("/station/:id", async (req, res) => {
  try {
    const stationId = req.params.id;
    const station = await stationController.getStationById(stationId);
    const availability = await stationController.getStationAvailabilityHistory(
      stationId
    );

    if (!station) {
      res.status(404).send("Station not found");
      return;
    }
    res.send(generateDetailedView(station, availability));
  } catch (error) {
    console.error("Error fetching station details:", error);
    res.status(500).send("Error fetching station details");
  }
});

app.get("/station/:id/live", async (req, res) => {
  try {
    const stationId = req.params.id;
    const status = await stationModel.fetchStationStatus(stationId);
    res.send(generateStatusPage(status, stationId));
  } catch (error) {
    console.error("Error fetching station status:", error);
    res.status(500).send("Error fetching station status");
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
