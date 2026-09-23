//! The software keyboard's height from UIKit, emitted as `keyboard`: WKWebView never reports it.

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
    // Hide fires after the frame change, and has the last word: a dismissal reports full height.
    observe(
        unsafe { UIKeyboardWillChangeFrameNotification },
        app.clone(),
        height_from,
    );
    observe(unsafe { UIKeyboardWillHideNotification }, app, |_| 0.0);
}
