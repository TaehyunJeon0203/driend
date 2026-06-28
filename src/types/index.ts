export interface User {
  id: string;
  email: string;
  username: string;
  avatar_url?: string;
  vehicle?: Vehicle;
  created_at: string;
}

export interface Vehicle {
  id: string;
  user_id: string;
  make: string;
  model: string;
  year: number;
  color?: string;
}

export interface Drive {
  id: string;
  user_id: string;
  started_at: string;
  ended_at?: string;
  distance_meters: number;
  max_speed_kmh: number;
  duration_seconds: number;
  route_points?: RoutePoint[];
}

export interface RoutePoint {
  id: string;
  drive_id: string;
  latitude: number;
  longitude: number;
  speed_kmh: number;
  recorded_at: string;
}

export interface VisitedCity {
  id: string;
  user_id: string;
  city_code: string;
  city_name: string;
  first_visited_at: string;
  photo_url?: string;
}

export interface Friendship {
  id: string;
  user_id: string;
  friend_id: string;
  status: 'pending' | 'accepted';
  created_at: string;
}

export type RankingCategory =
  | 'total_distance'
  | 'cities_visited'
  | 'max_speed'
  | 'longest_drive'
  | 'longest_drive_duration'
  | 'night_drives'
  | 'monthly_distance';
