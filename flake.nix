{
  description = "Agent skills and the Bitwarden Agent Access login adapter";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { self, nixpkgs, ... }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-linux"
      ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      node = pkgs: pkgs.nodejs_24;
      pnpm = pkgs: pkgs.pnpm_11.override { nodejs-slim = pkgs.nodejs-slim_24; };
    in
    {
      devShells = forAll (
        pkgs:
        {
          default = pkgs.mkShell {
            packages = [
              (node pkgs)
              (pnpm pkgs)
              pkgs.python312
            ];
          };
        }
        // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isDarwin {
          login = pkgs.mkShell {
            packages = [
              (node pkgs)
              (pkgs.callPackage ./nix/agent-access.nix { })
              pkgs.bitwarden-cli
              pkgs.which
              pkgs.python312
            ];
          };
        }
      );

      packages.aarch64-darwin.agent-access =
        nixpkgs.legacyPackages.aarch64-darwin.callPackage ./nix/agent-access.nix
          { };

      checks = forAll (pkgs: {
        login =
          pkgs.runCommand "bitwarden-login-tests"
            {
              nativeBuildInputs = [ (node pkgs) ];
            }
            ''
              node --test ${self}/tests/*.test.mjs > "$out"
            '';
      });
      formatter = forAll (pkgs: pkgs.nixfmt-tree);
    };
}
