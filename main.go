package main

import (
	"embed"
	"log"

	"github.com/lirrensi/luminka/luminka"
)

//go:embed dist/*
var distAssets embed.FS

func main() {
	if err := luminka.Run(luminka.Config{
		Name:            "cancan",
		Mode:            appMode(),
		RootPolicy:      luminka.RootPolicyDetached,
		WindowTitle:     "CanCan",
		WindowWidth:     1440,
		WindowHeight:    920,
		WindowResizable: true,
		WindowDebug:     false,
		EnableScripts:   false,
		EnableShell:     false,
		Assets:          distAssets,
	}); err != nil {
		log.Fatal(err)
	}
}
