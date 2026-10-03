{
  description = "Stock Desk development environment";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [ nodejs_22 supabase-cli postgresql_17 jq curl rsync ];
          shellHook = ''
            echo "Stock Desk: npm install, npm run dev, npm run build"
          '';
        };
      });
    };
}
