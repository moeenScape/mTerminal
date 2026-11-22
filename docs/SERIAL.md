# Serial connections (F55)

## Using it

1. Connect the device (router/switch console cable, Arduino, ESP32, Raspberry Pi UART adapter…).
2. Open **Hosts → Serial devices → New serial profile**. Choose the detected device or type the
   port path (`/dev/ttyUSB0`, `/dev/ttyACM0`, `/dev/tty.usbserial-1410`, `COM3`), then the speed
   and line settings.
3. Choose **Save and connect**. The profile opens in a terminal tab; later, use **Connect** from
   the same panel.

Common settings: Cisco and most network equipment 9600 8N1; Arduino and ESP32 usually 115200
8N1. **Enter sends** controls the line ending (CR for most devices, LF or CR LF for some).
**Local echo** shows what you type on devices that do not echo it.

The tab's **⋯** menu has **Send break** (a 300 ms break signal), used for example for router
password recovery. Copy/paste, search, themes, split panes (a split opens a local shell) and
session logs work as in other tabs. Command history suggestions and startup snippets are not used
on serial tabs.

## Permissions and errors

- **Permission denied (Linux):** add your user to the `dialout` group, then log out and back in:
  `sudo usermod -aG dialout $USER`. Some distributions use `uucp` instead.
- **Device in use:** close screen, minicom, the Arduino IDE serial monitor or another tab using
  the port. mTerminal opens ports exclusively.
- **Device not found:** check the cable, choose **Refresh**, and pick the current port; USB
  adapters can change name when replugged.
- Unplugging the device ends the tab as *Serial device disconnected*; use **Reconnect serial**.

## Limits

- At most 50 saved profiles. Baud rates from 50 to 4,000,000, 5–8 data bits, none/even/odd/mark/
  space parity, 1/1.5/2 stop bits, none/RTS-CTS/XON-XOFF flow control (support depends on the
  adapter and operating system).
- Output is decoded as UTF-8. Profiles are not part of workspace exports or templates; a serial
  tab in a template is restored as a local shell.
- Linux placeholder ports `/dev/ttyS*` without detected hardware are hidden from the list but can
  still be typed manually.
- Modem-control lines (DTR/RTS toggling), XMODEM/ZMODEM file transfer and hex view are not
  available yet.

## Implementation

`src/main/terminal/serial.ts` wraps the `serialport` package (native `@serialport/bindings-cpp`,
rebuilt for Electron by `npm install` / `npm run rebuild:native`, and unpacked from the asar in
the `.deb`) as a terminal transport. `src/main/terminal/serial-ipc.ts` validates requests,
stores profiles (schema v13) and opens serial tabs through the existing terminal registry, so
output batching, back-pressure, session logs and cleanup are shared with other tabs.

## Verification

Unit tests in `tests/unit/serial.test.ts` cover validation, newline translation, error mapping,
the transport against serialport's mock port (I/O, local echo, disconnect, missing device,
cancellation), profile storage and tab behavior. Following the phase workflow they are written
but not yet run. `npm run check` and `npm run build` pass. Real hardware has not been verified.
