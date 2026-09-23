//! SF Symbols rendered to PNG for native menu icons (macOS only).

/// PNG bytes of the SF Symbol `name`, black on transparent; `None` when it doesn't exist here.
#[cfg(target_os = "macos")]
pub fn sf_symbol_png(name: &str, point_size: f64) -> Option<Vec<u8>> {
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSFontWeightRegular, NSImage,
        NSImageSymbolConfiguration,
    };
    use objc2_foundation::{NSDictionary, NSString};

    let img = NSImage::imageWithSystemSymbolName_accessibilityDescription(
        &NSString::from_str(name),
        None,
    )?;
    let cfg = NSImageSymbolConfiguration::configurationWithPointSize_weight(point_size, unsafe {
        NSFontWeightRegular
    });
    let img = img.imageWithSymbolConfiguration(&cfg)?;
    let tiff = img.TIFFRepresentation()?;
    let rep = NSBitmapImageRep::imageRepWithData(&tiff)?;
    let png = unsafe {
        rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }?;
    Some(png.to_vec())
}

#[cfg(not(target_os = "macos"))]
pub fn sf_symbol_png(_name: &str, _point_size: f64) -> Option<Vec<u8>> {
    None
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    fn renders_known_symbol_and_rejects_unknown() {
        let png = super::sf_symbol_png("trash", 32.0).expect("trash symbol");
        assert!(png.starts_with(&[0x89, b'P', b'N', b'G']));
        assert!(super::sf_symbol_png("definitely.not.a.symbol", 32.0).is_none());
    }
}
