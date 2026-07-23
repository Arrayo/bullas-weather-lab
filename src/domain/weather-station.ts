export interface WeatherStation {
  id: string;
  name: string;
  province: string;
  latitude: number;
  longitude: number;
  elevation: number | null;
}
