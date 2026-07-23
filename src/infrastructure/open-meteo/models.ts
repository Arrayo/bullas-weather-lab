export const OPEN_METEO_MODELS = [
  "ecmwf_ifs025",
  "ecmwf_aifs025",
  "gfs_global",
  "icon_global",
  "gem_global",
  "cma_grapes_global",
] as const;

export type OpenMeteoModel = (typeof OPEN_METEO_MODELS)[number];

export const OPEN_METEO_MODEL_LABELS: Record<OpenMeteoModel, string> = {
  ecmwf_ifs025: "ECMWF IFS 0.25",
  ecmwf_aifs025: "ECMWF AIFS 0.25",
  gfs_global: "GFS Global",
  icon_global: "ICON Global",
  gem_global: "GEM Global",
  cma_grapes_global: "CMA GRAPES Global",
};
