//! The software keyboard's height, straight from UIKit.
//!
//! WKWebView doesn't report the keyboard through `visualViewport`, so the web
//! layer has no way to know how much of the screen is covered. UIKit does: the
//! keyboard notifications carry its frame, whose height in points is the same
//! unit as a CSS pixel. It is emitted as `keyboard` and the frontend puts it
//! in `--kb`.

use block2::RcBlock;
use objc2::runtime::AnyObject;
use objc2_foundation::{NSDictionary, NSNotification, NSNotificationCenter, NSString, NSValue};
use objc2_ui_kit::{
    UIKeyboardFrameEndUserInfoKey, UIKeyboardWillChangeFrameNotification,
    UIKeyboardWillHideNotification,
};
use tauri::{AppHandle, Emitter};

/// Height in points of the keyboard the notification describes.
fn height_from(note: &NSNotification) -> f64 {
    let Some(info) = note.userInfo() else {
        return 0.0;
    };
    let info: &NSDictionary<NSString, AnyObject> = unsafe { &*(&*info as *const _ as *const _) };
    let Some(value) = info.objectForKey(unsafe { UIKeyboardFrameEndUserInfoKey }) else {
        return 0.0;
    };
    let value: &NSValue = unsafe { &*(&*value as *const _ as *const NSValue) };
    value.get_rect().map_or(0.0, |r| r.size.height)
}

fn observe(name: &'static NSString, app: AppHandle, height: fn(&NSNotification) -> f64) {
    let block = RcBlock::new(move |note: std::ptr::NonNull<NSNotification>| {
        let h = height(unsafe { note.as_ref() });
        if let Err(e) = app.emit("keyboard", h) {
            eprintln!("keyboard: {e}");
        }
    });
    unsafe {
        NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
            Some(name),
            None,
            None,
            &block,
        );
    }
    // The notification centre holds the block for the life of the app.
    std::mem::forget(block);
}

pub fn watch(app: AppHandle) {
    // Hide fires after the frame change that accompanies it, so it has the last
    // word: a dismissing keyboard still reports its full height on the way out.
    observe(
        unsafe { UIKeyboardWillChangeFrameNotification },
        app.clone(),
        height_from,
    );
    observe(unsafe { UIKeyboardWillHideNotification }, app, |_| 0.0);
}
