import { Pool, QueryResult } from "pg";
import { Station, StationStatus } from "../types/types";
import { BaseModel } from "./BaseModel";

export class StationModel extends BaseModel {
  constructor(pool: Pool) {
    super(pool);
  }

  async fetchStationStatus(station_id: string): Promise<StationStatus> {
    const query = `
    SELECT station_id, plug_type, plug_status, timestamp
    FROM station_status
    WHERE station_id = $1 
      AND timestamp >= NOW() - INTERVAL '1 days'
    ORDER BY timestamp DESC;
  `;

    try {
      const { rows: filteredResults }: QueryResult<StationStatus> =
        await this.pool.query(query, [station_id]);

      const stationStatus: StationStatus | null = filteredResults.length
        ? filteredResults[0]
        : null;

      if (!stationStatus) {
        return {
          station_id,
          plug_type: "Unknown",
          plug_status: "Unknown",
          timestamp: new Date(),
          duration: 0,
        };
      }

      // Identify the first status
      const firstStatus = stationStatus.plug_status.trim();
      let durationCount = 0;

      // Count how many consecutive rows have the same status
      for (const { plug_status } of filteredResults) {
        if (plug_status.trim() === firstStatus) {
          durationCount++;
        } else {
          break; // Stop counting when the status changes
        }
      }
      return {
        station_id: stationStatus.station_id.trim(),
        plug_type: stationStatus.plug_type.trim(),
        plug_status: firstStatus || "",
        duration: durationCount,
        timestamp: stationStatus.timestamp,
      };
    } catch (error) {
      console.error(
        `Error fetching station status for station_id ${station_id}:`,
        error
      );
      throw error;
    }
  }

  async fetchStationAvailability(
    stationId: string,
    interval: string = "7 days"
  ): Promise<StationStatus[]> {
    const query = `
    SELECT plug_type, plug_status, timestamp
    FROM station_status
    WHERE station_id = $1 AND 
      timestamp >= NOW() - INTERVAL '${interval}'
    ORDER BY timestamp ASC; -- Ascending to calculate duration correctly
  `;

    try {
      const result = await this.pool.query(query, [stationId]);
      const rows = result.rows;
      const mergedData: StationStatus[] = [];

      if (rows.length > 0) {
        let plugType = rows[0].plug_type;
        let startTime = rows[0].timestamp;
        let endTime = rows[0].timestamp;
        let currentStatus = rows[0].plug_status;

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (row.plug_status === currentStatus) {
            endTime = row.timestamp; // Extend the duration
          } else {
            // Calculate duration
            const duration = Math.round(
              (endTime.getTime() - startTime.getTime()) / 60000
            ); // Duration in minutes
            if (duration >= 0) {
              mergedData.push({
                station_id: stationId,
                plug_type: plugType,
                plug_status: currentStatus,
                timestamp: startTime,
                duration: duration,
              });
            }

            // Reset for the new group
            currentStatus = row.plug_status;
            startTime = row.timestamp;
            endTime = row.timestamp;
          }
        }

        // Handle the final group
        const finalDuration = Math.round(
          (endTime.getTime() - startTime.getTime()) / 60000
        ); // Duration in minutes
        if (finalDuration >= 0) {
          mergedData.push({
            station_id: stationId,
            plug_type: plugType,
            plug_status: currentStatus,
            timestamp: startTime,
            duration: finalDuration,
          });
        }
      }

      return mergedData.reverse();
    } catch (error) {
      console.error("Error in fetchStationAvailability:", error);
      throw error;
    }
  }

  async getStationsForMap(
    region?: string,
    fastOnly: boolean = false
  ): Promise<(Station & { status_timestamp?: Date })[]> {
    // Convert region to uppercase to match database values
    const dbRegion = region?.toUpperCase();

    const query = `
    SELECT 
      s.*,
      ls.plug_status AS status,
      ls.timestamp AS status_timestamp
    FROM stations s
    INNER JOIN LATERAL (
      SELECT plug_status, timestamp
      FROM station_status ss
      WHERE ss.station_id = s.station_id
      ORDER BY ss.timestamp DESC
      LIMIT 1
    ) ls ON true
    WHERE 
      s.latitude IS NOT NULL 
      AND s.longitude IS NOT NULL
      ${dbRegion ? `AND s.region = $1` : ""}
      ${fastOnly ? "" : "AND LOWER(ls.plug_status) = 'available'"}
      ${fastOnly ? `AND s.max_electric_power > 19` : ""};
  `;

    try {
      console.log("Fetching stations with region:", dbRegion); // Debug log
      const { rows } = await this.pool.query(query, dbRegion ? [dbRegion] : []);
      console.log(`Found ${rows.length} stations for region ${dbRegion}`); // Debug log

      // Log a sample station to verify data
      if (rows.length > 0) {
        console.log("Sample station:", {
          id: rows[0].station_id,
          name: rows[0].name,
          region: rows[0].region,
        });
      }

      return rows.map((row) => ({
        ...row,
        price: parseFloat(row.price),
      }));
    } catch (error) {
      console.error("Error fetching stations:", error);
      throw error;
    }
  }

  async getAllStations(region?: string): Promise<Station[]> {
    // Convert region to uppercase to match database values
    const dbRegion = region?.toUpperCase();

    const query = `
      SELECT * FROM stations s
      WHERE latitude IS NOT NULL 
        AND longitude IS NOT NULL
        ${dbRegion ? `AND s.region = $1` : ""}
      ORDER BY price ASC;
    `;

    try {
      console.log("Fetching all stations with region:", dbRegion); // Debug log
      const { rows } = await this.pool.query(query, dbRegion ? [dbRegion] : []);
      console.log(`Found ${rows.length} stations for region ${dbRegion}`); // Debug log
      return rows.map((row) => ({
        ...row,
        price: parseFloat(row.price),
      }));
    } catch (error) {
      console.error("Error fetching all stations:", error);
      throw error;
    }
  }

  async fetchStationStatusByCity(city: string): Promise<StationStatus[]> {
    const query = `
    SELECT 
      DISTINCT ON (s.station_id) 
      s.station_id,
      ss.plug_type,
      ss.plug_status,
      ss.timestamp
    FROM station_status ss
    INNER JOIN stations s ON s.station_id = ss.station_id
    WHERE 
      (LOWER($1) = 'all' AND LOWER(ss.plug_status) = 'available')
      OR 
      (LOWER($1) != 'all' AND LOWER(s.city) = LOWER($1))
    ORDER BY s.station_id, ss.timestamp DESC;
  `;

    try {
      const { rows }: QueryResult<StationStatus> = await this.pool.query(
        query,
        [city]
      );
      return rows;
    } catch (error) {
      console.error("Error fetching station status by city:", error);
      throw error;
    }
  }

  async getStationById(stationId: string): Promise<Station | null> {
    const query = "SELECT * FROM stations WHERE station_id = $1";
    try {
      const result = await this.pool.query(query, [stationId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error(`Error fetching station by ID ${stationId}:`, error);
      throw error;
    }
  }
}
