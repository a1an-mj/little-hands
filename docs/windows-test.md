# Windows test pass

Do this before handing over, on the owner's laptop or a Windows 10/11 virtual machine (Microsoft
offers free "Windows development environment" VMs). Tick each line. Anything that fails: note what
you did, what you saw, and a screenshot.

## 0. Get the installer
1. On GitHub: **Actions → Windows installer → Run workflow** (or push a tag: `git tag v1.0.0 && git push origin v1.0.0`).
2. When the run is green, open it and download **Little-Hands-Setup** under *Artifacts*. Unzip it:
   `Little Hands Setup <version>.exe`.

## 1. Install
- [ ] Double-click the setup file. Windows shows "Windows protected your PC" (the installer isn't
      code-signed): **More info → Run anyway**. This happens only the first time.
- [ ] It installs without asking for an administrator password and opens Little Hands.
- [ ] There is a **Little Hands** shortcut on the Desktop and in the Start menu, with the blue hand icon.

## 2. First run and PIN
- [ ] "Welcome to Little Hands": choose a 4-digit PIN, type it again.
- [ ] The recovery code appears. Write it down.
- [ ] Dates read the Indian way (e.g. 20 Nov 2026), money as ₹1,500.
- [ ] The theme follows Windows light/dark; the switch changes it and it is remembered after restarting.

## 3. Students and programs
- [ ] New admission with a photo, LKG (Mon–Fri) and Transport, admission fee ₹2,000. Saves; the profile shows it.
- [ ] Students list: search by name, by phone; the program filter works.

## 4. Payments
- [ ] Profile → Fees & payments: the months are listed with "Due for N days".
- [ ] Record a part payment (Cash), then the rest (UPI with a reference). "Paid".
- [ ] Reverse a payment with a reason: the original shows "Reversed".
- [ ] Fees screen: who owes, and this month's report.

## 5. Attendance
- [ ] Home → Today's arrivals: Arrived (shows the laptop's time), Mark left, Undo.
- [ ] Attendance screen: Mark the rest present → Save.
- [ ] "School closed today", then Open again.

## 6. Backups (OneDrive or Google Drive for desktop, and a USB drive)
- [ ] Settings → Set up backups: choose the OneDrive (or Google Drive) folder, a backup password (write it down).
- [ ] "Last backup: Today, …". The file appears in the folder, and OneDrive uploads it (cloud icon turns green).
- [ ] Back up now → a second file.
- [ ] Close Little Hands → a third file appears.
- [ ] Change the folder to a USB drive; unplug it; Back up now → a clear "Is the drive plugged in?" message,
      and Home shows a red backup warning. Plug it back in, Back up now → fine again.
- [ ] Next day (or change the Windows date forward 1 day): opening the app makes one backup by itself.

## 7. Restore (a "new laptop")
- [ ] Create a second Windows user account, sign in to it, install Little Hands there.
- [ ] On the welcome screen: **Restore from a backup** → pick a backup file from OneDrive/USB → wrong
      password is refused → right password shows "Backup from … · N students · N payments".
- [ ] Replace everything → the app restarts, asks for the **old** PIN, and all students, payments
      and attendance are there.
- [ ] Settings shows "Backups are not set up yet" (set them up again on this laptop).

## 8. Restart, lock, update
- [ ] Restart Windows, open Little Hands: everything is still there.
- [ ] Leave it 10 minutes: it locks itself. Wrong PIN 5 times → 30 s wait. Forgot PIN → recovery code works.
- [ ] Install the same (or a newer) setup file again over it: the data is kept.
- [ ] Uninstall from Windows Settings → Apps, install again: the data is still there
      (it lives in `%APPDATA%\little-hands`).
