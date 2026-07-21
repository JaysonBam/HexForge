# HexForge File Helper

HexForge File Helper is HexForge's optional Windows bridge for files stored across four workstation workflow folders. It is a portable Electron application; source files stay local unless a technician explicitly imports a supported slicer archive or copies a print-ready file.

## Build and package

From the HexForge repository on a development machine:

```powershell
npm install
npm run build:helper
npm run package:helper
npm run smoke:helper
```

The portable, runtime-inclusive artifact is `release/HexForgeFileHelper.exe`. The target workstation does not need Node.js, npm, Git, or the repository.

For development, run `npm run dev:helper`. The helper still binds only to `127.0.0.1`.

## First run and USB deployment

1. Copy `HexForgeFileHelper.exe` from a USB stick to a stable local location. Do not run it permanently from removable media if Start with Windows will be enabled.
2. Run the executable. The settings window opens and the helper remains available from its tray icon.
3. Choose separate **To Be Printed**, **Currently Printing**, **Completed Prints**, and **Do Not Print** folders.
4. Keep port `47821`, or set the same port in HexForge's **Files** connection popover on that workstation.
5. Add the exact hosted HexForge origin, for example `https://printing.example.com`. Wildcards and URL paths are rejected. Local Vite origins are included by default.
6. Confirm or select Bambu Studio and UltiMaker Cura paths, choose default mappings, and save.
7. Optionally enable **Start with Windows** and create Desktop/Start menu shortcuts.

Configuration and rotating logs are kept in `%APPDATA%\HexForgeFileHelper`. Replacing the stopped executable with a newer version does not remove these files. If the portable executable is moved, launch it once from its new location and recreate shortcuts or re-enable startup.

## Tray controls

The tray menu shows connection status, opens each workflow folder, opens settings and logs, restarts the helper, toggles Start with Windows, and exits cleanly. Double-clicking the tray icon opens settings.

## Folder and import behaviour

- New folders use `P{priority} {studentName} u{studentNumber} - TBC` in **To Be Printed**.
- Matching accepts any folder name beginning with the exact `P{priority}` prefix and uses stronger student metadata when needed. Ambiguous matches require an explicit choice in HexForge.
- When a new project is created, HexForge creates the standard project folder automatically. Existing projects with no matching folder retain the manual **Create Folder** action.
- Confirming production removes ` - TBC`; starting a print moves the folder to **Currently Printing**; finishing all parts moves it to **Completed Prints**; archiving moves it to **Do Not Print**.
- HexForge searches all four locations. A misplaced or incorrectly named folder remains accessible and is shown with a non-blocking repair action.
- HexForge can import `.3mf`, `.gcode.3mf`, and `.ufp` through its existing parser and parts pipeline.
- `.stl`, `.step`, `.stp`, `.obj`, and plain `.gcode` are visible and can be opened; print-ready files can be copied, but these formats are not imported as parts in v1.
- **Move to Printer** always copies. It never deletes or moves the source file.

## Security controls

- The API listens only on IPv4 loopback and requires an exact configured browser origin plus the `X-HexForge-File-Helper-Client` header.
- CORS, preflight, and Private Network Access requests are validated explicitly.
- The browser supplies project metadata and opaque identifiers, never filesystem paths, destinations, executables, or shell commands.
- Every path is canonicalized and checked against its configured workflow folder. Escaping symlinks/junctions, traversal, hidden/system entries, and stale file IDs are rejected.
- Slicer processes use argument arrays with shell execution disabled. Destination selection occurs only in a native helper dialog.
- Side-effecting API calls require idempotency keys.

## Windows smoke test

1. Start the helper and choose four temporary workflow folders.
2. Add the local Vite or deployed HexForge origin.
3. Open HexForge and confirm **Files connected** appears.
4. Create a project and confirm its folder appears automatically in the Overview side panel.
5. Add STL, G-code, G-code.3MF, and UFP fixtures to that folder and refresh local files.
6. Import a G-code.3MF or UFP file and confirm parts appear through the normal review pipeline. Import it again and confirm a second set of parts is created intentionally.
7. Open a supported file using a configured slicer.
8. Copy a print-ready file to a temporary destination, exercise an existing-name choice, and verify source and destination both remain.
9. Confirm production, start one print, finish all parts, and archive a test project; verify each rename or workflow-folder move.
10. Exit the helper and confirm project editing, uploads, quotations, printing, and collection still operate normally.

If Bambu Studio or Cura is not installed, verify that HexForge reports the missing configuration and offers to open helper settings; do not treat that as a successful slicer-launch test.

## Troubleshooting

- **Files unavailable:** start the helper and verify the port in the HexForge connection popover.
- **Files setup needed:** open helper settings and choose all four workflow folders.
- **Workflow folders unavailable:** reconnect the drive or replace the unavailable location.
- **Hosted app cannot connect:** add its exact scheme/host/port origin to the helper allowlist.
- **Slicer missing:** choose the installed `.exe` in helper settings.
- **Detailed diagnostics:** use **Open logs** from the tray; logs exclude file contents, credentials, and absolute workflow paths.
