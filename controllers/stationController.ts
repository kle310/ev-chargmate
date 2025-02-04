import { Request, Response } from "express";
import { StationModel } from "../models/stationModel";
import { AppError, catchAsync } from "../middleware/errorHandler";
import { Station, StationStatus } from "../types/types";

interface StationQuery {
  station_id?: string;
  city?: string;
}

export class StationController {
  private stationModel: StationModel;

  constructor(stationModel: StationModel) {
    this.stationModel = stationModel;
  }

  getStatus = catchAsync(
    async (
      req: Request<{}, {}, {}, StationQuery>,
      res: Response
    ): Promise<void> => {
      const { station_id, city } = req.query;

      const stationId = station_id ? decodeURIComponent(station_id) : undefined;
      const decodedCity = city
        ? decodeURIComponent(city).replace(/_/g, " ")
        : undefined;

      if (!stationId && !decodedCity) {
        throw new AppError(
          "Please provide either station_id or city parameter",
          400
        );
      }

      if (decodedCity) {
        const stationStatuses =
          await this.stationModel.fetchStationStatusByCity(decodedCity);
        res.status(200).json({
          status: "success",
          data: stationStatuses,
        });
        return;
      }

      const status = await this.stationModel.fetchStationStatus(stationId!);
      res.status(200).json({
        status: "success",
        data: status,
      });
    }
  );

  fetchStationsForMap = async (
    region?: string,
    fastOnly: boolean = false
  ): Promise<Station[]> => {
    try {
      return await this.stationModel.getStationsForMap(region, fastOnly);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      throw new AppError(
        `Failed to fetch stations for map: ${errorMessage}`,
        500
      );
    }
  };

  getStationById = async (stationId: string): Promise<Station> => {
    if (!stationId) {
      throw new AppError("Station ID is required", 400);
    }

    const station = await this.stationModel.getStationById(stationId);

    if (!station) {
      throw new AppError(`Station with ID ${stationId} not found`, 404);
    }

    return station;
  };

  getStationAvailabilityHistory = async (
    stationId: string
  ): Promise<StationStatus[]> => {
    if (!stationId) {
      throw new AppError("Station ID is required", 400);
    }

    return await this.stationModel.fetchStationAvailability(stationId);
  };
}
