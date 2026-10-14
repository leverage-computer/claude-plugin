{
  description = "The Leverage plugin for Claude Code: its development shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    git-hooks.url = "github:cachix/git-hooks.nix";
    git-hooks.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    {
      self,
      nixpkgs,
      git-hooks,
    }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forEach = f: nixpkgs.lib.genAttrs systems (system: f system nixpkgs.legacyPackages.${system});
    in
    {
      # Lints each commit once the shell is entered, and `nix flake check`.
      checks = forEach (
        system: pkgs: {
          pre-commit = git-hooks.lib.${system}.run {
            src = ./.;
            hooks = {
              biome.enable = true;
              nixfmt.enable = true;
            };
          };
        }
      );

      devShells = forEach (
        system: pkgs: {
          default = pkgs.mkShell {
            inherit (self.checks.${system}.pre-commit) shellHook;
            packages = [
              pkgs.nodejs_24
              pkgs.pnpm
              # Zed's language server for flake.nix.
              pkgs.nil
            ]
            ++ self.checks.${system}.pre-commit.enabledPackages;
          };
        }
      );
    };
}
