export interface AppConfig {
  readonly appName: "Pardon My Trade";
  readonly environment: string;
  readonly configVersion: string;
  readonly defaultSport: "football";
  readonly fixturePath: string;
  readonly readOnlyMode: true;
}

export function createDefaultConfig(): AppConfig {
  return {
    appName: "Pardon My Trade",
    environment: process.env.PMT_ENV ?? "local",
    configVersion: "0.1.0-fixture",
    defaultSport: "football",
    fixturePath: process.env.PMT_FIXTURE_PATH ?? "tests/fixtures/sample-football-league.json",
    readOnlyMode: true
  };
}
